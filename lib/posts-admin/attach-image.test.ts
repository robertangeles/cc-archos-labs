import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import type { DB } from "../db";

// Regression suite for the pipeline extracted out of
// app/api/admin/posts/[id]/image/route.ts.
//
// The route worked before this extraction and had no coverage of its own, so
// these exist to prove the move changed nothing observable: every one of the
// 13 image columns still gets written, with the same values, from the same
// bytes. A silent regression here means every future post ships with a broken
// or missing featured image and nothing fails loudly.

const harness: { db: DB; client: PGlite } = {} as never;
const putSpy = vi.fn();

vi.mock("../db", () => ({ getDb: () => harness.db }));
vi.mock("../r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../r2")>();
  return {
    ...actual,
    r2ConfigFromEnv: () => r2Configured,
    buildR2Client: () => ({}) as never,
    putToR2: (input: unknown) => putSpy(input),
  };
});

// Shaped as the real R2Config so a reader is not misled about what the code
// under test receives. Only its null-ness actually drives a branch here.
const R2_CONFIG = {
  accountId: "acct",
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "test-bucket",
  publicUrl: "https://cdn.example.com",
};
let r2Configured: typeof R2_CONFIG | null = R2_CONFIG;

const {
  attachImageToPost,
  ImageDecodeError,
  ImageStorageError,
} = await import("./attach-image");
const { R2NotConfiguredError } = await import("../r2");
const { UnsupportedFormatError } = await import("../image-pipeline");

// Only the columns attachImageToPost touches, plus what its FK needs. The
// route's own suite owns the fuller post stub.
const STUBS = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" text NOT NULL UNIQUE
  );
  CREATE TABLE "post" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug" text NOT NULL UNIQUE,
    "title" text NOT NULL,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    "og_image_path" text,
    "og_image_generated_at" timestamptz,
    "og_image_alt" text,
    "og_image_width" integer,
    "og_image_height" integer,
    "og_image_filename" text,
    "og_image_mime_type" text,
    "og_image_size_kb" integer,
    "og_image_uploaded_by" uuid REFERENCES "users"("id"),
    "og_image_uploaded_at" timestamptz,
    "og_image_checksum" text,
    "og_image_r2_key" text,
    "og_image_deleted_at" timestamptz
  );
`;

/** A real PNG, so Sharp and image-size do real work rather than being mocked. */
async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 40, b: 70 },
    },
  })
    .png()
    .toBuffer();
}

async function postRow(id: string): Promise<Record<string, unknown>> {
  const res = await harness.client.query<Record<string, unknown>>(
    `SELECT * FROM "post" WHERE id = $1`,
    [id],
  );
  return res.rows[0];
}

let postId: string;

beforeAll(async () => {
  harness.client = new PGlite();
  await harness.client.exec(STUBS);
  harness.db = drizzle(harness.client, { schema }) as unknown as DB;
});

afterAll(async () => {
  await harness.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  r2Configured = R2_CONFIG;
  putSpy.mockResolvedValue({ publicUrl: "https://cdn.example.com/blog/x.png" });
  await harness.client.exec(`DELETE FROM "post"; DELETE FROM "users";`);
  await harness.client.query(`INSERT INTO "users" ("email") VALUES ('admin')`);
  const res = await harness.client.query<{ id: string }>(
    `INSERT INTO "post" ("slug","title") VALUES ('my-post','My Post') RETURNING id`,
  );
  postId = res.rows[0].id;
});

describe("attachImageToPost writes every image column", () => {
  it("populates all 13 columns in one call", async () => {
    const buffer = await png(1160, 400);
    const out = await attachImageToPost({
      postId,
      slug: "my-post",
      buffer,
      alt: "A figure in an empty lobby",
    });

    const row = await postRow(postId);

    // Not a loop over keys: naming each one means a dropped column fails here
    // rather than passing because the loop also lost it.
    expect(row.og_image_path).toBe("https://cdn.example.com/blog/x.png");
    expect(row.og_image_generated_at).toBeInstanceOf(Date);
    expect(row.og_image_alt).toBe("A figure in an empty lobby");
    expect(row.og_image_width).toBe(1160);
    expect(row.og_image_height).toBe(400);
    expect(row.og_image_filename).toBe(out.filename);
    expect(row.og_image_mime_type).toBe("image/png");
    expect(row.og_image_size_kb).toBe(out.sizeKb);
    expect(row.og_image_uploaded_by).toEqual(expect.any(String));
    expect(row.og_image_uploaded_at).toBeInstanceOf(Date);
    expect(row.og_image_checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(row.og_image_r2_key).toBe(`blog/my-post/${out.filename}`);
    expect(row.og_image_deleted_at).toBeNull();
  });

  it("bumps updated_at so the optimistic lock in the admin form stays in sync", async () => {
    const before = (await postRow(postId)).updated_at as Date;
    await new Promise((r) => setTimeout(r, 5));
    await attachImageToPost({
      postId,
      slug: "my-post",
      buffer: await png(600, 200),
      alt: "alt",
    });
    expect(((await postRow(postId)).updated_at as Date).getTime()).toBeGreaterThan(
      before.getTime(),
    );
  });

  it("clears a prior soft-delete so re-attaching restores the image", async () => {
    await harness.client.query(
      `UPDATE "post" SET og_image_deleted_at = now() WHERE id = $1`,
      [postId],
    );
    await attachImageToPost({
      postId,
      slug: "my-post",
      buffer: await png(600, 200),
      alt: "alt",
    });
    expect((await postRow(postId)).og_image_deleted_at).toBeNull();
  });

  it("touches only the target post", async () => {
    const other = await harness.client.query<{ id: string }>(
      `INSERT INTO "post" ("slug","title") VALUES ('other','Other') RETURNING id`,
    );
    await attachImageToPost({
      postId,
      slug: "my-post",
      buffer: await png(600, 200),
      alt: "alt",
    });
    expect((await postRow(other.rows[0].id)).og_image_path).toBeNull();
  });
});

describe("filename and R2 key", () => {
  it("content-addresses the filename so a new upload busts the immutable cache", async () => {
    const a = await attachImageToPost({
      postId,
      slug: "my-post",
      buffer: await png(600, 200),
      alt: "alt",
    });
    const b = await attachImageToPost({
      postId,
      slug: "my-post",
      buffer: await png(601, 200),
      alt: "alt",
    });
    expect(a.filename).not.toBe(b.filename);
    expect(a.filename).toBe(`my-post-featured-${a.checksum.slice(0, 8)}.png`);
  });

  it("is stable for identical bytes", async () => {
    const buffer = await png(600, 200);
    const a = await attachImageToPost({ postId, slug: "my-post", buffer, alt: "alt" });
    const b = await attachImageToPost({ postId, slug: "my-post", buffer, alt: "alt" });
    expect(a.filename).toBe(b.filename);
    expect(a.checksum).toBe(b.checksum);
  });

  it("nests the key under the post slug", async () => {
    const out = await attachImageToPost({
      postId,
      slug: "my-post",
      buffer: await png(600, 200),
      alt: "alt",
    });
    expect(out.r2Key).toBe(`blog/my-post/${out.filename}`);
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({ key: out.r2Key, contentType: "image/png" }),
    );
  });
});

describe("alt text", () => {
  it("trims and caps at 125 characters", async () => {
    const out = await attachImageToPost({
      postId,
      slug: "my-post",
      buffer: await png(600, 200),
      alt: `   ${"a".repeat(200)}   `,
    });
    expect(out.alt.length).toBe(125);
    expect((await postRow(postId)).og_image_alt).toHaveLength(125);
  });
});

describe("failure modes", () => {
  it("throws UnsupportedFormatError on bytes Sharp cannot read", async () => {
    await expect(
      attachImageToPost({
        postId,
        slug: "my-post",
        buffer: Buffer.from("this is not an image at all"),
        alt: "alt",
      }),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it("throws R2NotConfiguredError rather than writing a row with no image", async () => {
    r2Configured = null;
    await expect(
      attachImageToPost({
        postId,
        slug: "my-post",
        buffer: await png(600, 200),
        alt: "alt",
      }),
    ).rejects.toBeInstanceOf(R2NotConfiguredError);
    expect((await postRow(postId)).og_image_path).toBeNull();
  });

  it("throws ImageStorageError and leaves the post untouched when the put fails", async () => {
    putSpy.mockRejectedValue(new Error("network"));
    await expect(
      attachImageToPost({
        postId,
        slug: "my-post",
        buffer: await png(600, 200),
        alt: "alt",
      }),
    ).rejects.toBeInstanceOf(ImageStorageError);
    // The DB write comes after the put, so a failed upload must not leave a
    // post pointing at an object that does not exist.
    expect((await postRow(postId)).og_image_path).toBeNull();
  });

  it("exports ImageDecodeError for the route's 400 mapping", () => {
    expect(new ImageDecodeError()).toBeInstanceOf(Error);
    expect(new ImageDecodeError().name).toBe("ImageDecodeError");
  });
});

// Sharp generating megapixels of noise and then walking the quality ladder is
// genuinely slow — seconds, not milliseconds. These two carry their own
// timeout rather than being made fast and meaningless with a tiny input.
describe("compression", () => {
  /** Noise resists PNG compression, so the ladder really has work to do. */
  async function noisyPng(width: number, height: number): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        // Required by sharp's Create type even when noise supplies the pixels.
        background: { r: 0, g: 0, b: 0 },
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();
  }

  it("keeps a large image under the 500 KB DB CHECK", async () => {
    const noisy = await noisyPng(1450, 500);
    expect(noisy.byteLength).toBeGreaterThan(500 * 1024);

    const out = await attachImageToPost({
      postId,
      slug: "my-post",
      buffer: noisy,
      alt: "alt",
    });
    expect(out.sizeKb).toBeLessThanOrEqual(500);
    expect((await postRow(postId)).og_image_size_kb).toBeLessThanOrEqual(500);
  }, 30_000);

  it("records the dimensions of the stored image, not the original", async () => {
    const out = await attachImageToPost({
      postId,
      slug: "my-post",
      buffer: await noisyPng(1450, 500),
      alt: "alt",
    });
    const row = await postRow(postId);
    expect(row.og_image_width).toBe(out.width);
    expect(row.og_image_height).toBe(out.height);
    // Whatever the ladder did, the stored aspect ratio must survive it.
    expect(out.width / out.height).toBeCloseTo(1450 / 500, 1);
  }, 30_000);
});
