// PUT    /api/admin/posts/[id]/image  — upload a featured image from
//   device (multipart/form-data with `file` + `alt` fields).
//
//   Validations (HTTP layer, defence in depth with DB CHECK constraints):
//     - file size <= 10 MB pre-compression ceiling (sanity guard)
//     - alt non-empty after trim
//     - file present + non-zero bytes
//   MIME validation lives in lib/image-pipeline.ts via Sharp's
//   magic-byte detection (the browser's File.type is unreliable). Sharp
//   accepts PNG/JPEG/WebP as-is and transcodes AVIF/HEIC/GIF/TIFF to
//   WebP so the DB CHECK on mime stays satisfied without a migration.
//
//   Pipeline:
//     parse → validate → read buffer → attachImageToPost()
//   Everything from compression onward lives in
//   lib/posts-admin/attach-image.ts, because the blog agent needs the same
//   pipeline from a cron where there is no session to gate on.
//
//   The 500 KB DB CHECK on og_image_size_kb is now satisfied via
//   lib/image-pipeline.ts (Sharp quality+resize ladder) rather than by
//   rejecting the upload. See wiki/concepts/image-pipeline.md.
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

import { eq } from "drizzle-orm";
import { getDb } from "../../../../../../lib/db";
import { post } from "../../../../../../lib/db/schema";
import {
  getAdminPostById,
} from "../../../../../../lib/posts-admin";
import {
  attachImageToPost,
  ImageDecodeError,
  ImageStorageError,
} from "../../../../../../lib/posts-admin/attach-image";
import { PostNotFoundError } from "../../../../../../lib/posts-admin/types";
import { R2NotConfiguredError } from "../../../../../../lib/r2";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../../lib/rate-limit";
import {
  CompressionFloorError,
  UnsupportedFormatError,
} from "../../../../../../lib/image-pipeline";

export const runtime = "nodejs";

const UPLOAD_LIMIT_PER_HOUR = 20;
// Pre-compression sanity ceiling. Inputs above this are rejected outright
// before Sharp runs, so a malicious upload cannot exhaust memory.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALT_MAX_LEN = 125;

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
        error: `Image too large — max ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
      },
      { status: 400 },
    );
  }

  // MIME validation happens inside compressImageIfOverCap via Sharp's
  // magic-byte detection. The browser's File.type is captured for logs
  // only — Sharp's metadata is the source of truth (see lib/image-pipeline.ts).
  const browserReportedMime = (fileField.type || "").toLowerCase();

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

  // ---- Read bytes once ---------------------------------------------------
  const originalBuffer = Buffer.from(await fileField.arrayBuffer());

  // ---- Compress, store, persist -----------------------------------------
  // The pipeline itself lives in lib/posts-admin/attach-image.ts so the blog
  // agent can reuse it from a cron, where there is no session and no request
  // to send through this route. Everything above stays here: it is HTTP.
  try {
    await attachImageToPost({
      postId: id,
      slug: existing.slug,
      buffer: originalBuffer,
      alt: altClean,
      // The browser's File.type is unreliable and ignored by the pipeline;
      // logging it beside the format Sharp actually detected is what makes a
      // disagreement diagnosable.
      logContext: { browserReportedMime },
    });
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      return Response.json(
        {
          ok: false,
          error:
            "Unsupported image format — use PNG, JPEG, WebP, AVIF, HEIC, GIF, or TIFF.",
        },
        { status: 400 },
      );
    }
    if (err instanceof CompressionFloorError) {
      return Response.json(
        {
          ok: false,
          error:
            "Image cannot be compressed below the size limit — please resize the original first.",
        },
        { status: 400 },
      );
    }
    if (err instanceof ImageDecodeError) {
      return Response.json(
        {
          ok: false,
          error:
            "Could not read image dimensions — file may be corrupt or an unsupported variant.",
        },
        { status: 400 },
      );
    }
    if (err instanceof R2NotConfiguredError) {
      return Response.json({ ok: false, error: err.message }, { status: 503 });
    }
    if (err instanceof ImageStorageError) {
      return Response.json(
        { ok: false, error: "Upload failed — try again." },
        { status: 502 },
      );
    }
    // Anything left is a Sharp decode failure or a DB write failure. Both
    // predate this extraction and kept their original status codes.
    if (err instanceof Error && err.name === "DrizzleQueryError") {
      console.error("Posts image upload — DB update failed:", err);
      return Response.json(
        { ok: false, error: "Saved to R2 but DB update failed." },
        { status: 500 },
      );
    }
    console.error("Posts image upload — failed:", err);
    return Response.json(
      { ok: false, error: "Could not process image — file may be corrupt." },
      { status: 400 },
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
