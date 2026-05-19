// media-rehost.ts — download images from WP host, upload to Cloudflare R2,
// rewrite image URLs in the post's markdown.
//
// Uses Cloudflare's R2 REST API (api.cloudflare.com/client/v4/...) with
// Bearer auth, NOT the S3-compatible SDK. Cloudflare migrated to a unified
// Account API token model where new accounts only expose Bearer tokens
// (cfat_...); the legacy Access Key ID + Secret Access Key pair flow is
// no longer surfaced in their UI. Bearer + REST API works fine for our
// use case (PUT + DELETE).
//
// R2 layout (one key per post):
//   {bucket}/blog/{slug}/featured.{ext}
//   {bucket}/blog/{slug}/inline-{index}.{ext}
//
// Each post gets its own folder so deletes are atomic and audits are easy.
//
// Idempotency: PUT overwrites by default. Re-running the migration uploads
// the same bytes; no duplicates.

import { extname } from "node:path";
import { Buffer } from "node:buffer";
import type { EmbeddedPost, MediaRehostedPost } from "./types";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

// =============================================================================
// R2 config (Bearer-token based)
// =============================================================================

export interface R2Config {
  accountId: string;
  apiToken: string;
  bucket: string;
  /** Public URL the bucket serves at (pub-{hash}.r2.dev OR custom domain). */
  publicUrl: string;
}

export function r2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const apiToken = process.env.R2_API_TOKEN;
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!accountId || !apiToken || !bucket || !publicUrl) {
    return null;
  }
  return {
    accountId,
    apiToken,
    bucket,
    publicUrl: publicUrl.replace(/\/+$/, ""), // strip trailing slash
  };
}

// =============================================================================
// Public API
// =============================================================================

export interface RehostOptions {
  config: R2Config;
}

export async function rehostMedia(
  post: EmbeddedPost,
  opts: RehostOptions,
): Promise<MediaRehostedPost> {
  // 1. Featured image (always present per inventory).
  let featuredImageR2Url = "";
  if (post.featuredImage) {
    const key = r2Key(post.slug, "featured", post.featuredImage.source_url);
    await downloadAndUpload({
      sourceUrl: post.featuredImage.source_url,
      key,
      contentTypeHint: guessContentType(post.featuredImage.source_url),
      config: opts.config,
    });
    featuredImageR2Url = `${opts.config.publicUrl}/${key}`;
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
  const urls = new Set<string>();
  for (const m of post.contentMd.matchAll(IMG_RE)) {
    urls.add(m[2]);
  }

  // Only rehost images that look like they came from the WP host. Skip
  // external images (e.g. a Slack screenshot embed) — leave them as-is.
  const wpHost = inferWpHost();
  const targets = [...urls].filter((u) => isWpImage(u, wpHost));

  // Upload each. Sequential to keep R2 load gentle.
  const urlMap = new Map<string, string>();
  let index = 0;
  for (const url of targets) {
    const key = r2Key(post.slug, `inline-${index}`, url);
    try {
      await downloadAndUpload({
        sourceUrl: url,
        key,
        contentTypeHint: guessContentType(url),
        config: opts.config,
      });
      urlMap.set(url, `${opts.config.publicUrl}/${key}`);
    } catch (err) {
      // Don't fail the post for a single missing image. Leave the URL
      // pointing at the original (will 404 once WP is decommissioned);
      // flag in manifest via the inlineImageCount stat downstream.
      console.warn(
        `[media-rehost] post=${post.slug} url=${url} skipped: ${(err as Error).message}`,
      );
    }
    index++;
  }

  // Rewrite the markdown.
  const rewritten = post.contentMd.replace(IMG_RE, (whole, alt, url) => {
    const newUrl = urlMap.get(url);
    return newUrl ? `![${alt}](${newUrl})` : whole;
  });

  return { rewritten, count: urlMap.size };
}

// =============================================================================
// Download from WP + Upload to R2 via Cloudflare REST API
// =============================================================================

async function downloadAndUpload(args: {
  sourceUrl: string;
  key: string;
  contentTypeHint: string;
  config: R2Config;
}): Promise<void> {
  // 1. Download from WP host.
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
  const contentType =
    response.headers.get("content-type") ?? args.contentTypeHint;

  // 2. Upload to R2 via Cloudflare REST API.
  // Path: PUT /accounts/{id}/r2/buckets/{bucket}/objects/{key}
  // Key segments are URL-encoded individually so slashes remain path
  // separators but other special chars are escaped.
  const url = `${CF_API_BASE}/accounts/${args.config.accountId}/r2/buckets/${args.config.bucket}/objects/${encodeKey(args.key)}`;
  const putResponse = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${args.config.apiToken}`,
      "Content-Type": contentType,
    },
    body: buf,
    signal: AbortSignal.timeout(60_000),
  });
  if (!putResponse.ok) {
    const body = await putResponse.text();
    throw new Error(
      `R2 PUT ${putResponse.status} for key=${args.key}: ${body.slice(0, 200)}`,
    );
  }
}

/**
 * URL-encode each path segment of an R2 key. Preserves "/" as path
 * separators (Cloudflare's R2 REST API expects keys-with-slashes in the
 * URL path verbatim).
 */
function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

// =============================================================================
// Helpers
// =============================================================================

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
 * Infer the WP host from a known constant — the migration is specifically
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
