// media-rehost.ts — download images from WP host, upload to Cloudflare R2,
// rewrite image URLs in the post's markdown.
//
// R2 layout (one key per post):
//   {bucket}/blog/{slug}/featured.{ext}
//   {bucket}/blog/{slug}/inline-{index}.{ext}
//
// Each post gets its own folder so deletes are atomic and audits are easy.
// Filenames are normalised (no WP timestamp prefixes like "2026/04/foo.png"
// in the new R2 key — those stay in the lookup path for the original
// download).
//
// Idempotency: R2 PutObject overwrites by default. Re-running the
// migration uploads the same bytes; no duplicates.
//
// Bandwidth: ~400 MB of dedup'd WP images across 253 posts. R2 egress
// is FREE so re-runs cost only the storage class read on the WP side
// (negligible at this volume).

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { extname } from "node:path";
import { Buffer } from "node:buffer";
import type { EmbeddedPost, MediaRehostedPost } from "./types";

// =============================================================================
// R2 client (S3-compatible)
// =============================================================================

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public URL the bucket serves at (pub-{hash}.r2.dev OR custom domain). */
  publicUrl: string;
}

export function r2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    return null;
  }
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicUrl: publicUrl.replace(/\/+$/, ""), // strip trailing slash
  };
}

export function buildR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

// =============================================================================
// Public API
// =============================================================================

export interface RehostOptions {
  config: R2Config;
  client: S3Client;
}

export async function rehostMedia(
  post: EmbeddedPost,
  opts: RehostOptions,
): Promise<MediaRehostedPost> {
  // 1. Featured image (always present per inventory).
  let featuredImageR2Url = "";
  if (post.featuredImage) {
    const result = await downloadAndUpload({
      sourceUrl: post.featuredImage.source_url,
      key: r2Key(post.slug, "featured", post.featuredImage.source_url),
      contentTypeHint: guessContentType(post.featuredImage.source_url),
      client: opts.client,
      bucket: opts.config.bucket,
    });
    featuredImageR2Url = `${opts.config.publicUrl}/${result.key}`;
  }

  // 2. Inline images: scan the markdown, find ![alt](url) where url is
  //    on robertangeles.com, download + upload each, rewrite URL.
  const { rewritten, count } = await rewriteInlineImages(post, opts);

  return {
    ...post,
    contentMdRehosted: rewritten,
    featuredImageR2Url,
    inlineImageCount: count,
  };
}

// =============================================================================
// Inline image rewriting
// =============================================================================

const IMG_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;

async function rewriteInlineImages(
  post: EmbeddedPost,
  opts: RehostOptions,
): Promise<{ rewritten: string; count: number }> {
  // Find unique URLs first; we may have the same image referenced twice.
  const urls = new Set<string>();
  for (const m of post.contentMd.matchAll(IMG_RE)) {
    urls.add(m[2]);
  }

  // Only rehost images that look like they came from the WP host. Skip
  // external images (e.g. a Slack screenshot embed) — leave them as-is.
  const wpHost = inferWpHost();
  const targets = [...urls].filter((u) => isWpImage(u, wpHost));

  // Upload each. Sequential to keep R2 load gentle; could parallelise
  // with p-limit if migration time becomes a concern (it shouldn't —
  // average post has 0-3 inline images per inventory).
  const urlMap = new Map<string, string>();
  let index = 0;
  for (const url of targets) {
    const ext = extname(new URL(url).pathname) || ".png";
    const key = r2Key(post.slug, `inline-${index}`, url);
    try {
      await downloadAndUpload({
        sourceUrl: url,
        key,
        contentTypeHint: guessContentType(url),
        client: opts.client,
        bucket: opts.config.bucket,
      });
      urlMap.set(url, `${opts.config.publicUrl}/${key}`);
    } catch (err) {
      // Don't fail the post for a single missing image. Leave the URL
      // pointing at the original (will 404 once WP is decommissioned);
      // flag in manifest via the inlineImageCount stat downstream.
      console.warn(`[media-rehost] post=${post.slug} url=${url} skipped: ${(err as Error).message}`);
    }
    index++;
    // Use ext to avoid "unused variable" lint while keeping it for future
    // extension-based routing.
    void ext;
  }

  // Rewrite the markdown.
  const rewritten = post.contentMd.replace(IMG_RE, (whole, alt, url) => {
    const newUrl = urlMap.get(url);
    return newUrl ? `![${alt}](${newUrl})` : whole;
  });

  return { rewritten, count: urlMap.size };
}

// =============================================================================
// Download + upload
// =============================================================================

async function downloadAndUpload(args: {
  sourceUrl: string;
  key: string;
  contentTypeHint: string;
  client: S3Client;
  bucket: string;
}): Promise<{ key: string }> {
  const response = await fetch(args.sourceUrl, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "Mozilla/5.0 ArchosLabs-MigrateWp/1.0" },
  });
  if (!response.ok) {
    throw new Error(
      `Source image fetch ${response.status} from ${args.sourceUrl}`,
    );
  }
  const buf = Buffer.from(await response.arrayBuffer());
  // Prefer server's reported content-type; fall back to extension guess.
  const contentType = response.headers.get("content-type") ?? args.contentTypeHint;

  await args.client.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: buf,
      ContentType: contentType,
      // Public-read isn't a thing in R2; public access is configured at
      // the bucket level (custom domain or pub-{hash}.r2.dev). Don't set
      // ACL — R2 doesn't support it.
    }),
  );
  return { key: args.key };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a stable R2 key for a post's image:
 *   blog/{slug}/{label}{ext}
 *
 * `label` is "featured" or "inline-0", "inline-1", etc.
 * `ext` is derived from the source URL's pathname.
 */
function r2Key(slug: string, label: string, sourceUrl: string): string {
  let ext = extname(new URL(sourceUrl).pathname).toLowerCase();
  if (!ext || ext.length > 5) ext = ".png";
  return `blog/${slug}/${label}${ext}`;
}

function guessContentType(url: string): string {
  const ext = extname(new URL(url).pathname).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

/**
 * Infer the WP host from env (WP_DATABASE_URL is local — useless for image
 * domain). We use a hardcoded constant since the migration is specifically
 * for robertangeles.com. If the migration ever runs against a different
 * WP source, this becomes a config flag.
 */
function inferWpHost(): string {
  return "robertangeles.com";
}

function isWpImage(url: string, wpHost: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === wpHost || u.hostname === `www.${wpHost}`;
  } catch {
    return false;
  }
}
