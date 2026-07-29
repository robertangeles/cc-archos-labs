import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePostTestDb, type PostTestDb } from "../../tests/helpers/post-test-db";

// MANDATORY REGRESSION SUITE — last_reviewed_at preservation.
//
// The bug this guards against shipped silently and stayed live:
//
//   1. app/admin/(authed)/blog/posts/post-form.tsx builds its PUT body
//      WITHOUT a `lastReviewedAt` key (it is not an editable field in the
//      form).
//   2. The Zod schema declares it `.optional().nullable()`, so an absent
//      key arrives as `undefined`, not `null`.
//   3. normalisePostInput used to collapse that with `?? null`.
//   4. updatePost then wrote the NULL over whatever was stored.
//
// Net effect: EVERY save through the only blog post editor reset the post's
// freshness date. `last_reviewed_at` feeds `dateModified` in the Article
// JSON-LD, `article:modified_time` in the OG tags, sitemap `lastmod`, and the
// "Last reviewed" line in llms.txt — via `lastReviewedAt ?? publishedAt`. So a
// human edit made the whole site tell Google the post had NOT been touched
// since its original publish date. The opposite of the intended signal.
//
// The fix gives the field three states instead of two:
//
//     undefined -> key omitted   -> leave the stored value alone
//     null      -> explicit clear -> write NULL
//     Date      -> explicit set   -> write the date
//
// If someone reintroduces `?? null` in normalisePostInput, or drops the
// conditional spread in updatePost's `.set()`, the first test here fails.

let harness: PostTestDb;

vi.mock("../db", () => ({ getDb: () => harness.db }));
vi.mock("../indexnow", () => ({ pingIndexNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../site-config", () => ({ getSiteUrl: () => "https://archoslabs.xyz" }));
vi.mock("../og", () => ({ generateOgImage: vi.fn() }));
vi.mock("../embeddings", () => ({
  embedPostContent: vi.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
}));

const { updatePost } = await import("./index");

const REVIEWED_ON = new Date("2026-07-01T00:00:00.000Z");

async function readPost(id: string): Promise<{
  last_reviewed_at: Date | null;
  updated_at: Date;
  title: string;
}> {
  const res = await harness.client.query<{
    last_reviewed_at: Date | null;
    updated_at: Date;
    title: string;
  }>(`SELECT last_reviewed_at, updated_at, title FROM "post" WHERE id = $1`, [id]);
  return res.rows[0];
}

/** The body the admin form actually sends — note: no lastReviewedAt key. */
function formBody(over: Record<string, unknown> = {}) {
  return {
    slug: "post-1",
    title: "Post 1",
    contentMd: "Body.",
    excerpt: null,
    seoTitle: null,
    seoDescription: null,
    authorId: null,
    categoryId: null,
    tags: [],
    status: "draft" as const,
    visibility: "listed" as const,
    needsReview: false,
    scheduledPublishAt: null,
    ogImageAlt: null,
    ...over,
  };
}

describe("updatePost — last_reviewed_at preservation", () => {
  beforeEach(async () => {
    harness = await makePostTestDb();
  });
  afterEach(async () => {
    await harness.close();
  });

  it("preserves a stored last_reviewed_at when the key is absent", async () => {
    const id = await harness.createPost({
      status: "draft",
      scheduledPublishAt: null,
      lastReviewedAt: REVIEWED_ON,
    });
    const before = await readPost(id);

    await updatePost(id, formBody(), before.updated_at);

    const after = await readPost(id);
    expect(after.last_reviewed_at).not.toBeNull();
    expect(new Date(after.last_reviewed_at!).toISOString()).toBe(
      REVIEWED_ON.toISOString(),
    );
  });

  it("still writes NULL when the caller explicitly clears it", async () => {
    const id = await harness.createPost({
      status: "draft",
      scheduledPublishAt: null,
      lastReviewedAt: REVIEWED_ON,
    });
    const before = await readPost(id);

    await updatePost(id, formBody({ lastReviewedAt: null }), before.updated_at);

    expect((await readPost(id)).last_reviewed_at).toBeNull();
  });

  it("writes a new date when the caller supplies one", async () => {
    const id = await harness.createPost({
      status: "draft",
      scheduledPublishAt: null,
      lastReviewedAt: null,
    });
    const before = await readPost(id);
    const stamped = new Date("2026-07-20T09:30:00.000Z");

    await updatePost(id, formBody({ lastReviewedAt: stamped }), before.updated_at);

    const after = await readPost(id);
    expect(new Date(after.last_reviewed_at!).toISOString()).toBe(
      stamped.toISOString(),
    );
  });

  it("survives two consecutive form saves, not just one", async () => {
    // The original bug wiped on the FIRST save, but a naive fix that only
    // preserves when the row is untouched would still lose it on the second.
    const id = await harness.createPost({
      status: "draft",
      scheduledPublishAt: null,
      lastReviewedAt: REVIEWED_ON,
    });

    let row = await readPost(id);
    await updatePost(id, formBody({ title: "Edited once" }), row.updated_at);

    row = await readPost(id);
    await updatePost(id, formBody({ title: "Edited twice" }), row.updated_at);

    const after = await readPost(id);
    expect(after.title).toBe("Edited twice");
    expect(new Date(after.last_reviewed_at!).toISOString()).toBe(
      REVIEWED_ON.toISOString(),
    );
  });
});

describe("updatePost — human-review stamp decays with the content", () => {
  const REVIEWED = new Date("2026-07-20T00:00:00.000Z");

  async function readReview(id: string): Promise<Date | null> {
    const res = await harness.client.query<{ reviewed_by_human_at: Date | null }>(
      `SELECT reviewed_by_human_at FROM "post" WHERE id = $1`,
      [id],
    );
    return res.rows[0].reviewed_by_human_at;
  }

  async function seedReviewed(): Promise<string> {
    const id = await harness.createPost({ status: "draft", scheduledPublishAt: null });
    await harness.client.query(
      `UPDATE "post" SET reviewed_by_human_at = $2, content_md = $3 WHERE id = $1`,
      [id, REVIEWED, "Body."],
    );
    return id;
  }

  beforeEach(async () => {
    harness = await makePostTestDb();
  });
  afterEach(async () => {
    await harness.close();
  });

  it("keeps the credit through a typo-scale edit", async () => {
    const id = await seedReviewed();
    const before = await readPost(id);
    // "Body." -> "Body!" is a 0% length delta, well under the threshold.
    await updatePost(id, formBody({ contentMd: "Body!" }), before.updated_at);
    expect(await readReview(id)).not.toBeNull();
  });

  it("CLEARS the credit when the body is materially rewritten", async () => {
    // The claim is about specific text. Once that text is gone, nobody has
    // vouched for what is now on the page.
    const id = await seedReviewed();
    const before = await readPost(id);
    await updatePost(
      id,
      formBody({ contentMd: "An entirely different article body, much longer than before." }),
      before.updated_at,
    );
    expect(await readReview(id)).toBeNull();
  });

  it("still honours an explicit stamp on the same save", async () => {
    // This is the "Mark human-reviewed" action itself: it arrives carrying the
    // very contentMd it is vouching for, so the decay must not undo it.
    const id = await harness.createPost({ status: "draft", scheduledPublishAt: null });
    const before = await readPost(id);
    const stamp = new Date("2026-07-29T12:00:00.000Z");
    await updatePost(
      id,
      formBody({
        contentMd: "A completely rewritten body that trips the diff threshold.",
        reviewedByHumanAt: stamp,
      }),
      before.updated_at,
    );
    const got = await readReview(id);
    expect(got).not.toBeNull();
    expect(new Date(got!).toISOString()).toBe(stamp.toISOString());
  });

  it("does not resurrect a credit that was never set", async () => {
    const id = await harness.createPost({ status: "draft", scheduledPublishAt: null });
    const before = await readPost(id);
    await updatePost(id, formBody({ contentMd: "Rewritten entirely." }), before.updated_at);
    expect(await readReview(id)).toBeNull();
  });
});
