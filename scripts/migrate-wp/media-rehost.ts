// media-rehost.ts — download images from WP host, upload to Cloudflare R2,
// rewrite image URLs in the post's markdown.
//
// Auth: Cloudflare's S3-compatible API at {account_id}.r2.cloudflarestorage.com
// with AWS SigV4 signing. The credentials come directly from the per-bucket
// R2 token creation flow at:
//   Cloudflare dashboard → R2 Object Storage → API Tokens → Create Account API token
// That flow returns three things we use:
//   Access Key ID     (R2_ACCESS_KEY_ID)
//   Secret Access Key (R2_SECRET_ACCESS_KEY)
//   Endpoint URL      — implicit from R2_ACCOUNT_ID
//
// Do NOT use the top-level Account API tokens page — those tokens have a
// "Workers R2 Storage Bucket Item" permission that does not authorise the
// S3 endpoint regardless of how you derive the secret. We tried every hash
// variant; all 401. The R2-Object-Storage-scoped token IS the right kind.
//
// R2 layout (one key per post):
//   {bucket}/blog/{slug}/featured.{ext}
//   {bucket}/blog/{slug}/inline-{index}.{ext}
//
// Idempotency: S3 PutObject overwrites by default. Re-running uploads
// the same bytes; no duplicates.

import { extname } from "node:path";
import { Buffer } from "node:buffer";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { EmbeddedPost, MediaRehostedPost } from "./types";

// =============================================================================
// R2 config
// =============================================================================

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
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
    publicUrl: publicUrl.replace(/\/+$/, ""),
  };
}

/**
 * Build an S3 client pointed at Cloudflare R2 with the derived credentials.
 */
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
    const key = r2Key(post.slug, "featured", post.featuredImage.source_url);
    await downloadAndUpload({
      sourceUrl: post.featuredImage.source_url,
      key,
      contentTypeHint: guessContentType(post.featuredImage.source_url),
      client: opts.client,
      bucket: opts.config.bucket,
    });
    featuredImageR2Url = `${opts.config.publicUrl}/${key}`;
  }

  // 2. Inline images — scan markdown for ![alt](url) where url is on the
  //    WP host, download + upload each, rewrite URL.
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

  // Only rehost images that look like they came from the WP host.
  const wpHost = inferWpHost();
  const targets = [...urls].filter((u) => isWpImage(u, wpHost));

  const urlMap = new Map<string, string>();
  let index = 0;
  for (const url of targets) {
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
      console.warn(
        `[media-rehost] post=${post.slug} url=${url} skipped: ${(err as Error).message}`,
      );
    }
    index++;
  }

  const rewritten = post.contentMd.replace(IMG_RE, (whole, alt, url) => {
    const newUrl = urlMap.get(url);
    return newUrl ? `![${alt}](${newUrl})` : whole;
  });

  return { rewritten, count: urlMap.size };
}

// =============================================================================
// Download from WP + Upload to R2 via S3 SDK
// =============================================================================

async function downloadAndUpload(args: {
  sourceUrl: string;
  key: string;
  contentTypeHint: string;
  client: S3Client;
  bucket: string;
}): Promise<void> {
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

  await args.client.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: buf,
      ContentType: contentType,
    }),
  );
}

// Re-exported for the smoke test + Phase C teardown tooling.
export { DeleteObjectCommand, PutObjectCommand };

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
