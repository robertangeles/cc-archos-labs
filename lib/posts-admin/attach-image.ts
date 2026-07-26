import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { imageSize } from "image-size";
import { getDb } from "../db";
import { post, users } from "../db/schema";
import { getSiteUrl } from "../site-config";
import {
  buildR2Client,
  putToR2,
  r2ConfigFromEnv,
  R2NotConfiguredError,
} from "../r2";
import { compressImageIfOverCap } from "../image-pipeline";

// The persist half of a featured-image upload: compress, measure, checksum,
// push to R2, write the metadata columns.
//
// Extracted from app/api/admin/posts/[id]/image/route.ts so it has two callers.
// The route keeps everything HTTP — rate limiting, multipart parsing, size
// ceilings, status codes — because none of that applies to the second caller:
// the blog agent runs from a cron with no session and no request, and cannot
// go through a session-gated route to attach the image it just generated.
//
// Errors are thrown, not mapped. The route owns the HTTP mapping; a cron
// caller wants an exception it can log and fall back from.

/** Target size after compression. Matches the DB CHECK on og_image_size_kb. */
const TARGET_SIZE_BYTES = 500 * 1024;
const ALT_MAX_LEN = 125;

/** Persisted mime → extension. Only the three the DB CHECK permits. */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Bytes that Sharp accepted but nothing could read dimensions from. */
export class ImageDecodeError extends Error {
  constructor(message = "Could not read image dimensions.") {
    super(message);
    this.name = "ImageDecodeError";
  }
}

/** R2 was configured and reachable, but the put failed. */
export class ImageStorageError extends Error {
  constructor(message = "Image upload to storage failed.") {
    super(message);
    this.name = "ImageStorageError";
  }
}

export interface AttachImageInput {
  postId: string;
  /** Used for the R2 key and filename; the caller has already loaded the post. */
  slug: string;
  buffer: Buffer;
  alt: string;
  /** Merged into the compression log line. The route passes the browser's
   *  reported mime, which is unreliable and worth seeing next to the real one. */
  logContext?: Record<string, unknown>;
}

export interface AttachedImage {
  publicUrl: string;
  r2Key: string;
  filename: string;
  mime: string;
  sizeKb: number;
  width: number;
  height: number;
  checksum: string;
  alt: string;
  /** Format Sharp detected in the input bytes, before any transcode. */
  inputFormat: string;
}

/**
 * Compress, store and record a featured image against a post.
 *
 * Writes all 13 image columns in one UPDATE, including clearing
 * `og_image_deleted_at` so re-attaching over a soft-deleted image works.
 *
 * Throws `UnsupportedFormatError` / `CompressionFloorError` from the pipeline,
 * `ImageDecodeError` if dimensions cannot be read, `R2NotConfiguredError` if
 * storage is not set up, and `ImageStorageError` if the put fails.
 */
export async function attachImageToPost(
  input: AttachImageInput,
): Promise<AttachedImage> {
  const { postId, slug, buffer: original, alt, logContext } = input;

  const altClean = alt.trim().slice(0, ALT_MAX_LEN);
  const originalSizeKb = Math.round(original.byteLength / 1024);

  // Sharp detects the format from the bytes, transcodes anything that is not
  // png/jpeg/webp, and runs the quality + resize ladders until the buffer fits
  // the 500 KB cap. Decompression-bomb-guarded via limitInputPixels.
  const compressed = await compressImageIfOverCap(original, TARGET_SIZE_BYTES);
  const { buffer, sizeKb, outputMime: mime, inputFormat } = compressed;

  if (compressed.compressed) {
    // Privacy-safe: sizes and compression parameters only, never content.
    console.log(
      "Post image attach — compressed",
      JSON.stringify({
        ...logContext,
        inputFormat,
        outputMime: mime,
        originalSizeKb,
        finalSizeKb: sizeKb,
        ratio: Math.round((sizeKb / originalSizeKb) * 100),
        qualityUsed: compressed.qualityUsed,
        resizedTo: compressed.resizedTo,
      }),
    );
  }

  // ---- Dimensions ---------------------------------------------------------
  let width: number;
  let height: number;
  try {
    const dim = imageSize(buffer);
    if (!dim.width || !dim.height) throw new Error("no dimensions");
    width = dim.width;
    height = dim.height;
  } catch (err) {
    console.error("Post image attach — dimension read failed:", err);
    throw new ImageDecodeError();
  }

  // ---- Content-addressed filename ----------------------------------------
  // The first 8 chars of the sha256 go in the filename so each upload gets a
  // unique URL. R2 objects are served immutable, so this is what busts the
  // CDN and browser caches without weakening the cache policy.
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const filename = `${slug}-featured-${checksum.slice(0, 8)}.${MIME_TO_EXT[mime]}`;
  const r2Key = `blog/${slug}/${filename}`;

  // ---- Uploader ----------------------------------------------------------
  // Single seeded admin row today (email='admin'). Resolved here rather than
  // passed in, because both callers want exactly this row.
  const adminRows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin"))
    .limit(1);
  const uploadedBy = adminRows[0]?.id ?? null;

  // ---- Storage -----------------------------------------------------------
  const r2Config = r2ConfigFromEnv();
  if (!r2Config) throw new R2NotConfiguredError();

  let publicUrl: string;
  try {
    const result = await putToR2({
      config: r2Config,
      client: buildR2Client(r2Config),
      key: r2Key,
      body: buffer,
      contentType: mime,
    });
    publicUrl = result.publicUrl;
  } catch (err) {
    console.error("Post image attach — R2 put failed:", err);
    throw new ImageStorageError();
  }

  // ---- Persist -----------------------------------------------------------
  const now = new Date();
  await getDb()
    .update(post)
    .set({
      ogImagePath: publicUrl,
      ogImageGeneratedAt: now,
      ogImageAlt: altClean,
      ogImageWidth: width,
      ogImageHeight: height,
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
    .where(eq(post.id, postId));

  return {
    publicUrl,
    r2Key,
    filename,
    mime,
    sizeKb,
    width,
    height,
    checksum,
    alt: altClean,
    inputFormat,
  };
}

/** Committed house illustration, used when a post's own generation fails. */
const FALLBACK_PUBLIC_PATH = "/images/blog-fallback.webp";
const FALLBACK_DISK_PATH = join("public", "images", "blog-fallback.webp");
const FALLBACK_ALT = "Archos Labs editorial illustration";

/**
 * Point a post at the committed house illustration.
 *
 * Not an R2 upload: the asset is static, served by Next.js, and identical for
 * every post that needs it — uploading ninety copies of the same 45 KB file
 * would be pure waste. So `og_image_r2_key` and `og_image_checksum` stay null,
 * which is also how you tell a fallback from a generated image in the DB.
 *
 * The path is absolute because OG meta, RSS enclosures and JSON-LD all need a
 * fully-qualified URL; a relative one silently breaks every social preview.
 *
 * Dimensions are read from the file rather than hardcoded so regenerating the
 * asset with scripts/generate-blog-fallback-image.mjs cannot leave them stale.
 */
export async function attachFallbackImageToPost(postId: string): Promise<void> {
  const bytes = await readFile(FALLBACK_DISK_PATH);
  const dim = imageSize(bytes);
  const now = new Date();

  await getDb()
    .update(post)
    .set({
      ogImagePath: `${getSiteUrl().replace(/\/+$/, "")}${FALLBACK_PUBLIC_PATH}`,
      ogImageGeneratedAt: now,
      ogImageAlt: FALLBACK_ALT,
      ogImageWidth: dim.width ?? null,
      ogImageHeight: dim.height ?? null,
      ogImageFilename: "blog-fallback.webp",
      ogImageMimeType: "image/webp",
      ogImageSizeKb: Math.round(bytes.byteLength / 1024),
      ogImageUploadedAt: now,
      ogImageDeletedAt: null,
      updatedAt: now,
    })
    .where(eq(post.id, postId));
}
