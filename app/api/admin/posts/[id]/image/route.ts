// PUT    /api/admin/posts/[id]/image  — upload a featured image from
//   device (multipart/form-data with `file` + `alt` fields).
//
//   Validations (HTTP layer, defence in depth with DB CHECK constraints):
//     - file size <= 500 KB           (DB also: og_image_size_kb <= 500)
//     - mime in {png, jpeg, webp}     (DB also: CHECK constraint)
//     - alt non-empty after trim
//     - file present + non-zero bytes
//
//   On success, populates all 11 image-metadata columns:
//     og_image_path, og_image_generated_at, og_image_alt, og_image_width,
//     og_image_height, og_image_filename, og_image_mime_type,
//     og_image_size_kb, og_image_uploaded_by, og_image_uploaded_at,
//     og_image_checksum, og_image_r2_key, og_image_deleted_at (null).
//
// DELETE /api/admin/posts/[id]/image  — soft-delete the featured image.
//   Sets og_image_deleted_at = now() but keeps og_image_path populated
//   for a grace period (a future R2 cleanup job will null it + delete
//   the R2 object). UI treats deleted_at NOT NULL as "no image" for
//   render purposes.
//
// Gated by proxy.ts. Rate-limited at 20/hr per IP.

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { imageSize } from "image-size";
import { getDb } from "../../../../../../lib/db";
import { post, users } from "../../../../../../lib/db/schema";
import {
  getAdminPostById,
} from "../../../../../../lib/posts-admin";
import { PostNotFoundError } from "../../../../../../lib/posts-admin/types";
import {
  buildR2Client,
  putToR2,
  r2ConfigFromEnv,
  R2NotConfiguredError,
} from "../../../../../../lib/r2";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../../lib/rate-limit";

export const runtime = "nodejs";

const UPLOAD_LIMIT_PER_HOUR = 20;
const MAX_FILE_BYTES = 500 * 1024; // 500 KB — matches DB CHECK constraint
const ALT_MAX_LEN = 125;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params;

  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`posts:upload-image:${ip}`, UPLOAD_LIMIT_PER_HOUR);
  if (!limit.ok) {
    return Response.json(
      {
        ok: false,
        error: "Rate limit reached — try again in an hour.",
        resetAt: new Date(limit.resetAt).toISOString(),
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.max(
            1,
            Math.ceil((limit.resetAt - Date.now()) / 1000),
          ).toString(),
        },
      },
    );
  }

  const existing = await getAdminPostById(id);
  if (!existing) {
    return Response.json(
      { ok: false, error: "Post not found." },
      { status: 404 },
    );
  }

  // ---- Parse + validate the upload --------------------------------------
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid upload (expected multipart/form-data)." },
      { status: 400 },
    );
  }

  const fileField = formData.get("file");
  if (!(fileField instanceof File)) {
    return Response.json(
      { ok: false, error: "Missing 'file' field in upload." },
      { status: 400 },
    );
  }
  if (fileField.size === 0) {
    return Response.json(
      { ok: false, error: "Uploaded file is empty." },
      { status: 400 },
    );
  }
  if (fileField.size > MAX_FILE_BYTES) {
    return Response.json(
      {
        ok: false,
        error: `Image too large — max ${MAX_FILE_BYTES / 1024} KB.`,
      },
      { status: 400 },
    );
  }

  const mime = (fileField.type || "").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return Response.json(
      {
        ok: false,
        error: "Unsupported image type — use PNG, JPEG, or WebP.",
      },
      { status: 400 },
    );
  }

  const altRaw = formData.get("alt");
  const altTrimmed = typeof altRaw === "string" ? altRaw.trim() : "";
  if (!altTrimmed) {
    return Response.json(
      {
        ok: false,
        error: "Alt text is required — describe the image for accessibility.",
      },
      { status: 400 },
    );
  }
  const altClean = altTrimmed.slice(0, ALT_MAX_LEN);

  // ---- Read bytes once; derive width/height/checksum from buffer --------
  const buffer = Buffer.from(await fileField.arrayBuffer());

  let dimensions: { width: number; height: number };
  try {
    const dim = imageSize(buffer);
    if (!dim.width || !dim.height) {
      throw new Error("image-size returned no dimensions");
    }
    dimensions = { width: dim.width, height: dim.height };
  } catch (err) {
    console.error("Posts image upload — dimension read failed:", err);
    return Response.json(
      {
        ok: false,
        error:
          "Could not read image dimensions — file may be corrupt or an unsupported variant.",
      },
      { status: 400 },
    );
  }

  const checksum = createHash("sha256").update(buffer).digest("hex");
  const sizeKb = Math.round(buffer.byteLength / 1024);

  // ---- Build filename + R2 key per Rob's convention --------------------
  //   `{slug}-featured-01.{ext}`   (lowercase, no spaces — handled by
  //   slug which is already kebab-case)
  // The R2 key includes the post-scoped path prefix so different
  // posts can have the same -01.png basename without collision.
  const ext = MIME_TO_EXT[mime];
  const filename = `${existing.slug}-featured-01.${ext}`;
  const r2Key = `blog/${existing.slug}/${filename}`;

  // ---- Resolve uploader id ---------------------------------------------
  // Single seeded admin row today (email='admin'). Lookup-by-email is
  // stable; when per-user login lands this resolves to the actual user.
  const adminRows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin"))
    .limit(1);
  const uploadedBy = adminRows[0]?.id ?? null;

  // ---- R2 round-trip ---------------------------------------------------
  const r2Config = r2ConfigFromEnv();
  if (!r2Config) {
    return Response.json(
      { ok: false, error: new R2NotConfiguredError().message },
      { status: 503 },
    );
  }
  const r2Client = buildR2Client(r2Config);

  let publicUrl: string;
  try {
    const result = await putToR2({
      config: r2Config,
      client: r2Client,
      key: r2Key,
      body: buffer,
      contentType: mime,
    });
    publicUrl = result.publicUrl;
  } catch (err) {
    console.error("Posts image upload — R2 put failed:", err);
    return Response.json(
      { ok: false, error: "Upload failed — try again." },
      { status: 502 },
    );
  }

  // ---- Persist all metadata + bump updatedAt for optimistic-lock sync --
  const now = new Date();
  try {
    await getDb()
      .update(post)
      .set({
        ogImagePath: publicUrl,
        ogImageGeneratedAt: now,
        ogImageAlt: altClean,
        ogImageWidth: dimensions.width,
        ogImageHeight: dimensions.height,
        ogImageFilename: filename,
        ogImageMimeType: mime,
        ogImageSizeKb: sizeKb,
        ogImageUploadedBy: uploadedBy,
        ogImageUploadedAt: now,
        ogImageChecksum: checksum,
        ogImageR2Key: r2Key,
        ogImageDeletedAt: null, // clear any prior soft-delete
        updatedAt: now,
      })
      .where(eq(post.id, id));
  } catch (err) {
    console.error("Posts image upload — DB update failed:", err);
    return Response.json(
      { ok: false, error: "Saved to R2 but DB update failed." },
      { status: 500 },
    );
  }

  const refreshed = await getAdminPostById(id);
  if (!refreshed) {
    throw new PostNotFoundError(`Post "${id}" disappeared post-update.`);
  }
  return Response.json({ ok: true, data: refreshed });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  const existing = await getAdminPostById(id);
  if (!existing) {
    return Response.json(
      { ok: false, error: "Post not found." },
      { status: 404 },
    );
  }

  // Soft-delete: stamp og_image_deleted_at, keep og_image_path populated.
  // Public render treats deleted_at NOT NULL as "no image" via
  // lib/posts.ts SELECTs. Future cleanup job will null + delete the
  // R2 object after the grace period.
  const now = new Date();
  await getDb()
    .update(post)
    .set({
      ogImageDeletedAt: now,
      updatedAt: now,
    })
    .where(eq(post.id, id));

  const refreshed = await getAdminPostById(id);
  if (!refreshed) {
    throw new PostNotFoundError(`Post "${id}" disappeared post-update.`);
  }
  return Response.json({ ok: true, data: refreshed });
}
