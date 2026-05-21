import "server-only";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Cloudflare R2 client + helpers. Used by:
//   - scripts/migrate-wp/media-rehost.ts (WP image rehosting)
//   - app/api/admin/posts/[id]/image/route.ts (featured-image upload)
//
// R2 is S3-compatible — we use the @aws-sdk/client-s3 with an endpoint
// override + region "auto". Credentials come from the R2 Object-Storage
// scoped token (NOT the top-level Account API token — see the migration
// script's docstring for the gotcha).
//
// Env vars required (all five must be set):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   R2_BUCKET, R2_PUBLIC_URL
//
// At runtime (Render), R2_* vars must be added to the service env. If
// they're missing, r2ConfigFromEnv() returns null and admin upload
// routes will fail closed with a clear "R2 not configured" message.

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
  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucket ||
    !publicUrl
  ) {
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

export interface PutToR2Input {
  config: R2Config;
  client: S3Client;
  /** R2 object key (path inside the bucket, no leading slash). */
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
  /** Optional Cache-Control header to set on the object. */
  cacheControl?: string;
}

/**
 * Upload a single object to R2. Returns the public URL the object will
 * be served from. PutObject overwrites by default, so re-running with
 * the same key replaces the existing object.
 */
export async function putToR2(input: PutToR2Input): Promise<{ publicUrl: string }> {
  await input.client.send(
    new PutObjectCommand({
      Bucket: input.config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl ?? "public, max-age=31536000, immutable",
    }),
  );
  return {
    publicUrl: `${input.config.publicUrl}/${input.key}`,
  };
}

/**
 * Class of errors callers can match on to distinguish "R2 misconfigured"
 * (return 503 to the admin) from generic upload failures (return 500).
 */
export class R2NotConfiguredError extends Error {
  override name = "R2NotConfiguredError";
  constructor() {
    super(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
        "R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL in the runtime env.",
    );
  }
}
