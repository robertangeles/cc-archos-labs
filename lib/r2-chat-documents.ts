import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getIntegrationConfig } from "./integration-config";

// Private Cloudflare R2 storage for Chat Attach Files (confidential client
// documents). Parallel to lib/r2.ts (the PUBLIC blog-media bucket) — this one
// is intentionally private:
//   - credentials come from the DB-backed Integrations panel ("Chat Documents
//     (Cloudflare R2)"), NOT env vars, so they're admin-controllable +
//     encrypted at rest (see lib/integration-config.ts). Env vars R2_CHAT_* /
//     R2_ACCOUNT_ID are only a fallback.
//   - there is NO public URL. Objects are served ONLY through the authz'd
//     /api/chat/documents/[id]/file proxy (ownership-checked, streamed).
//
// R2 is S3-compatible — same @aws-sdk/client-s3 with an endpoint override +
// region "auto" as lib/r2.ts.

export interface R2ChatConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

/**
 * Resolve the private-R2 config from the Integrations panel (or env fallback).
 * Returns null if any required field is missing — callers turn null into a 503
 * "file storage isn't configured" (matching the kanban attachment route).
 */
export async function r2ChatConfigFromIntegration(): Promise<R2ChatConfig | null> {
  const cfg = await getIntegrationConfig();
  const accountId = cfg.r2ChatAccountId;
  const accessKeyId = cfg.r2ChatAccessKeyId;
  const secretAccessKey = cfg.r2ChatSecretAccessKey;
  const bucketName = cfg.r2ChatBucketName;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

export function buildR2ChatClient(config: R2ChatConfig): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export interface PutChatDocumentInput {
  config: R2ChatConfig;
  client: S3Client;
  /** Object key — the document row id, no leading slash. */
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
}

/**
 * Store confidential document bytes. Marked private/no-store so no intermediary
 * caches them — the object is reachable only via the authz'd proxy. Overwrites
 * on the same key (idempotent re-upload).
 */
export async function putChatDocument(input: PutChatDocumentInput): Promise<void> {
  await input.client.send(
    new PutObjectCommand({
      Bucket: input.config.bucketName,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: "private, no-store",
    }),
  );
}

export interface GetChatDocumentInput {
  config: R2ChatConfig;
  client: S3Client;
  key: string;
  /** Optional HTTP Range header value to forward (browser PDF viewers seek). */
  range?: string;
}

export interface ChatDocumentObject {
  body: ReadableStream<Uint8Array>;
  contentType?: string;
  contentLength?: number;
  /** Present when a Range was honoured — caller returns 206 + this header. */
  contentRange?: string;
  acceptRanges?: string;
}

/**
 * Fetch document bytes for the authz'd download/preview proxy. Forwards the
 * client Range header so a large PDF seeks without a full download (returns
 * ContentRange when honoured — the route sends 206 in that case).
 */
export async function getChatDocument(
  input: GetChatDocumentInput,
): Promise<ChatDocumentObject> {
  const output = await input.client.send(
    new GetObjectCommand({
      Bucket: input.config.bucketName,
      Key: input.key,
      Range: input.range,
    }),
  );
  if (!output.Body) {
    throw new Error("R2 GetObject returned no body");
  }
  return {
    body: output.Body.transformToWebStream(),
    contentType: output.ContentType,
    contentLength: output.ContentLength,
    contentRange: output.ContentRange,
    acceptRanges: output.AcceptRanges,
  };
}

export interface DeleteChatDocumentInput {
  config: R2ChatConfig;
  client: S3Client;
  key: string;
}

/** Delete document bytes (called when a document row is removed). */
export async function deleteChatDocument(
  input: DeleteChatDocumentInput,
): Promise<void> {
  await input.client.send(
    new DeleteObjectCommand({
      Bucket: input.config.bucketName,
      Key: input.key,
    }),
  );
}

/**
 * Verify the credentials + bucket are reachable (used by the admin
 * test-connection route). Throws if the creds are wrong or the bucket is
 * missing; resolves on success.
 */
export async function headChatBucket(
  config: R2ChatConfig,
  client: S3Client,
): Promise<void> {
  await client.send(new HeadBucketCommand({ Bucket: config.bucketName }));
}

/**
 * Class callers can match on to distinguish "chat R2 not configured" (503 to
 * the user) from a generic upload/download failure (500).
 */
export class R2ChatNotConfiguredError extends Error {
  override name = "R2ChatNotConfiguredError";
  constructor() {
    super(
      "Chat document storage is not configured. Add the Cloudflare R2 " +
        "credentials under Admin → Integrations → Chat Documents.",
    );
  }
}
