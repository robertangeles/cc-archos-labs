import "server-only";
import { createHash } from "node:crypto";
import { getIntegrationConfig } from "./integration-config";

// ============================================================================
// Cloudinary signed-upload service.
//
// Raw REST integration — no `cloudinary` npm package. We build the signed
// upload request by hand (sha1 signature over the sorted params) and POST it
// with the global fetch + FormData/Blob (Node 18+). This keeps the dependency
// surface minimal, the same way the rest of lib/ avoids heavy SDKs.
//
// Credentials come from the DB-first integration config (env fallback during
// the grace window), so the admin Integrations panel is the single source of
// truth. cloudinaryConfigFromIntegration() returns null when storage is not
// configured; callers turn that into a 503 with a plain message.
// ============================================================================

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  // Optional folder prefix (e.g. "archos/cards"). null = account root.
  uploadFolder: string | null;
}

export interface CloudinaryUploadResult {
  url: string;
  bytes: number;
  publicId: string;
}

/**
 * Resolve Cloudinary credentials from the integration config (DB-first,
 * env-fallback). Returns null when cloud name, API key, or API secret is
 * missing — i.e. storage is not configured. The upload folder is optional.
 */
export async function cloudinaryConfigFromIntegration(): Promise<CloudinaryConfig | null> {
  const config = await getIntegrationConfig();
  const cloudName = config.cloudinaryCloudName;
  const apiKey = config.cloudinaryApiKey;
  const apiSecret = config.cloudinaryApiSecret;
  if (!cloudName || !apiKey || !apiSecret) return null;
  return {
    cloudName,
    apiKey,
    apiSecret,
    uploadFolder: config.cloudinaryUploadFolder ?? null,
  };
}

/**
 * Build the Cloudinary signature for a set of upload params.
 *
 * Cloudinary's scheme: take every param that is part of the signature
 * (everything except `file`, `api_key`, `resource_type`, `cloud_name`),
 * sort the keys alphabetically, join as `k=v` with `&`, append the API
 * secret, and SHA-1 hex the whole string.
 */
function signParams(
  params: Record<string, string>,
  apiSecret: string,
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1")
    .update(toSign + apiSecret)
    .digest("hex");
}

/**
 * Upload bytes to Cloudinary via a signed request. Throws a clear Error on
 * any failure (missing config, network error, non-2xx response). Returns the
 * secure URL, byte count, and public id from the Cloudinary JSON response.
 *
 * `auto/upload` lets Cloudinary detect image vs. raw file from the bytes, so
 * the same path handles images and arbitrary documents.
 */
export async function uploadToCloudinary(input: {
  bytes: Buffer | Uint8Array;
  fileName: string;
  mimeType: string;
  folder?: string;
}): Promise<CloudinaryUploadResult> {
  const config = await cloudinaryConfigFromIntegration();
  if (!config) {
    throw new Error("Cloudinary is not configured.");
  }

  // Resolve the target folder: explicit override wins, then the configured
  // default, else none.
  const folder = input.folder ?? config.uploadFolder ?? undefined;

  // Signed params (alphabetical sort happens in signParams). timestamp is
  // required by Cloudinary; folder is signed when present.
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedParams: Record<string, string> = { timestamp };
  if (folder) signedParams.folder = folder;
  const signature = signParams(signedParams, config.apiSecret);

  // Multipart body. The file is a Blob built from the raw bytes; api_key and
  // signature authenticate the request alongside the signed params.
  const form = new FormData();
  // Copy into a fresh Uint8Array backed by a plain ArrayBuffer so the Blob
  // constructor's BlobPart type accepts it (a Node Buffer / SharedArrayBuffer-
  // backed view isn't assignable in this TS config).
  const bytesCopy = new Uint8Array(input.bytes.byteLength);
  bytesCopy.set(input.bytes);
  const blob = new Blob([bytesCopy], {
    type: input.mimeType || "application/octet-stream",
  });
  form.append("file", blob, input.fileName);
  form.append("api_key", config.apiKey);
  form.append("timestamp", timestamp);
  if (folder) form.append("folder", folder);
  form.append("signature", signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`;

  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", body: form });
  } catch (err) {
    throw new Error(
      `Cloudinary upload request failed: ${
        err instanceof Error ? err.message : "network error"
      }`,
    );
  }

  if (!response.ok) {
    // Cloudinary returns a JSON { error: { message } } on failure. Surface
    // the message when present, otherwise the status.
    let detail = `status ${response.status}`;
    try {
      const body = (await response.json()) as {
        error?: { message?: string };
      };
      if (body?.error?.message) detail = body.error.message;
    } catch {
      // Non-JSON error body — keep the status detail.
    }
    throw new Error(`Cloudinary upload rejected: ${detail}`);
  }

  const body = (await response.json()) as {
    secure_url?: string;
    bytes?: number;
    public_id?: string;
  };
  if (!body.secure_url || !body.public_id) {
    throw new Error("Cloudinary upload returned an unexpected response shape.");
  }

  return {
    url: body.secure_url,
    bytes: typeof body.bytes === "number" ? body.bytes : input.bytes.length,
    publicId: body.public_id,
  };
}
