import { z } from "zod";

// Runtime-validated shape of the decrypted integration_secrets row.
//
// This file has NO server-only imports so client components (the admin
// form, form validation hooks) can import the schema + types directly.
// Server-side reads/writes live in lib/integration-config.ts.
//
// Field naming: camelCase here matches TypeScript convention. The DB row
// stores the same names in its JSONB value; no snake_case translation
// inside the JSON blob (CLAUDE.md's snake_case rule applies to columns,
// not JSONB payload keys).
//
// Boundary between "secret" and "config":
//   - secrets (must be encrypted at rest): values whose disclosure
//     enables an attacker. Field listed in ENCRYPTED_FIELDS.
//   - config (plaintext is fine): values that are operationally tweakable
//     and not exploit material.
//
// Both kinds live in the same JSONB blob — encryption is applied
// per-field by the loader, not at the row level. This lets the audit
// log distinguish "rotated API key" from "updated recipient email."

export const IntegrationConfigSchema = z.object({
  // Secrets (encrypted at rest).
  adminPassword: z.string().min(8, "must be at least 8 characters"),
  resendApiKey: z.string().min(1, "required"),
  // Provider-agnostic name. Today this holds the OpenRouter API key
  // (env var OPENROUTER_API_KEY in migration). Future provider swaps
  // (direct Anthropic, Cerebras, etc.) reuse the same field.
  llmApiKey: z.string().min(1, "required"),

  // Config (plaintext in the JSONB blob).
  contactRecipientEmail: z.email("must be a valid email address"),
  resendFromEmail: z
    .string()
    .min(1, "required")
    .max(254, "too long for an email From header"),
  // Nullable so the loader (and admin login, contact form, etc.) can
  // still resolve config when this isn't set yet. Only the LLM call
  // path treats null as a misconfiguration and surfaces a clear error
  // pointing at /admin/integrations. There is no code-level default —
  // the source of truth is the Settings UI. Provider-agnostic name
  // even though today's value is a Claude model identifier.
  llmModelId: z.string().min(1).nullable(),
  // Admin-curated list of OpenRouter model IDs that users can select
  // in the Skills Builder. Empty array = no models available.
  llmEnabledModels: z.array(z.string()).default([]),
  llmCustomModels: z.array(z.object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    description: z.string().default("Custom model"),
  })).default([]),

  // Google OAuth client credentials for the Book-a-Call flow. Lives in
  // the DB rather than env so the same secret-handling discipline (audit
  // log, encrypted at rest, no risk of accidental .env commit) covers
  // them. The redirect URI is the only piece that stays in env because
  // it's genuinely environment-specific (localhost vs prod URL).
  //
  // Both nullable — the loader returns the config even when Google isn't
  // configured yet (the OAuth start route surfaces a clear error when
  // the admin clicks Connect before filling these in).
  //
  // Client ID is identifier-grade (appears in OAuth URLs the browser
  // sees) so it's plaintext. Client Secret is the actual credential and
  // lives in ENCRYPTED_FIELDS.
  googleOauthClientId: z.string().min(1).nullable(),
  googleOauthClientSecret: z.string().min(1).nullable(),

  // Cloudflare Turnstile keys for booking-form bot protection. Site key
  // is public (rendered in the widget script tag), Secret key is the
  // server-side verification credential. Both nullable so the booking
  // route can no-op gracefully when Turnstile isn't yet configured.
  turnstileSiteKey: z.string().min(1).nullable(),
  turnstileSecretKey: z.string().min(1).nullable(),

  // GBrain persistent memory service. URL is plaintext (identifier-grade,
  // appears in fetch calls). Admin token is the credential used to
  // register per-user OAuth clients on GBrain — lives in ENCRYPTED_FIELDS.
  // Both nullable so the workspace chat works without brain configured.
  gbrainUrl: z.string().url().nullable(),
  gbrainAdminToken: z.string().min(1).nullable(),

  // Social platform OAuth credentials. Client IDs are identifier-grade
  // (plaintext). Client Secrets live in ENCRYPTED_FIELDS. Enabled toggles
  // let the admin disable a platform without removing credentials.
  twitterClientId: z.string().min(1).nullable(),
  twitterClientSecret: z.string().min(1).nullable(),
  twitterEnabled: z.boolean().default(false),
  linkedinClientId: z.string().min(1).nullable(),
  linkedinClientSecret: z.string().min(1).nullable(),
  linkedinEnabled: z.boolean().default(false),
  blueskyEnabled: z.boolean().default(false),

  // Cloudinary media storage for card attachments + cover images. Cloud
  // name and API key are identifier-grade (appear in signed-upload URLs),
  // so they're plaintext. API secret signs every upload — it lives in
  // ENCRYPTED_FIELDS. Upload folder is an optional plaintext prefix. All
  // nullable so the app runs without media storage configured (the upload
  // route returns a 503 with a plain message when these are missing).
  cloudinaryCloudName: z.string().min(1).nullable(),
  cloudinaryApiKey: z.string().min(1).nullable(),
  cloudinaryApiSecret: z.string().min(1).nullable(),
  cloudinaryUploadFolder: z.string().min(1).nullable(),
});

export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;

// Fields that the loader encrypts before writing and decrypts on read.
// Authoritative list — every encrypt/decrypt call sites should consult
// this rather than hard-coding key names.
export const ENCRYPTED_FIELDS = [
  "adminPassword",
  "resendApiKey",
  "llmApiKey",
  "googleOauthClientSecret",
  "turnstileSecretKey",
  "gbrainAdminToken",
  "twitterClientSecret",
  "linkedinClientSecret",
  "cloudinaryApiSecret",
] as const satisfies ReadonlyArray<keyof IntegrationConfig>;

export type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];

// Type-narrowing helper for callers that want to check "is this an
// encrypted field?" at runtime without hard-coding the list.
export function isEncryptedField(
  field: keyof IntegrationConfig,
): field is EncryptedField {
  return (ENCRYPTED_FIELDS as readonly string[]).includes(field);
}

// Hardcoded defaults used by the loader if both DB and env (during the
// grace window) are missing a config value. NEVER provides defaults for
// secrets — missing secrets must fail loudly.
//
// These mirror the in-code fallback that exists:
//   - app/api/contact/route.ts  ?? "rob.angeles@archoslabs.xyz"
//
// llmModelId default is null (no code-level fallback). lib/claude.ts
// treats null as a misconfiguration and surfaces a clear error
// pointing at /admin/integrations.
export const CONFIG_DEFAULTS = {
  contactRecipientEmail: "rob.angeles@archoslabs.xyz",
  // Required-but-defaulted: Resend rejects undefined From, so we have to
  // pick a sensible default rather than throw. Domain matches the brand.
  resendFromEmail: "Archos Labs <hello@archoslabs.xyz>",
  llmModelId: null,
  llmEnabledModels: [] as string[],
  llmCustomModels: [] as Array<{ id: string; name: string; provider: string; description: string }>,
  gbrainUrl: null,
  gbrainAdminToken: null,
  twitterClientId: null,
  twitterClientSecret: null,
  twitterEnabled: false,
  linkedinClientId: null,
  linkedinClientSecret: null,
  linkedinEnabled: false,
  blueskyEnabled: false,
  cloudinaryCloudName: null,
  cloudinaryApiKey: null,
  cloudinaryApiSecret: null,
  cloudinaryUploadFolder: null,
} as const satisfies Pick<
  IntegrationConfig,
  "contactRecipientEmail" | "resendFromEmail" | "llmModelId" | "llmEnabledModels" | "llmCustomModels" | "gbrainUrl" | "gbrainAdminToken" | "twitterClientId" | "twitterClientSecret" | "twitterEnabled" | "linkedinClientId" | "linkedinClientSecret" | "linkedinEnabled" | "blueskyEnabled" | "cloudinaryCloudName" | "cloudinaryApiKey" | "cloudinaryApiSecret" | "cloudinaryUploadFolder"
>;

// Storage shape inside site_setting.value for key='integration_secrets'.
// Encrypted fields hold a base64 blob from lib/booking-crypto.ts.
// Plaintext fields hold their raw value. Both share a single JSONB blob
// so a single SELECT loads everything.
export const StoredIntegrationConfigSchema = z.object({
  // Encrypted fields (base64 ciphertext from lib/booking-crypto encrypt()).
  adminPassword: z.string().min(1),
  resendApiKey: z.string().min(1),
  llmApiKey: z.string().min(1),

  // Plaintext fields (validated when decrypted into IntegrationConfig).
  contactRecipientEmail: z.string().min(1),
  resendFromEmail: z.string().min(1),
  llmModelId: z.string().min(1).nullable(),
  llmEnabledModels: z.array(z.string()).nullish(),
  llmCustomModels: z.array(z.object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    description: z.string().optional(),
  })).nullish(),

  // Google OAuth credentials. `.nullish()` so a stored blob written
  // before these fields existed still parses — missing-key reads back
  // as `undefined`, which the loader normalises to `null` before
  // running IntegrationConfigSchema.
  googleOauthClientId: z.string().min(1).nullish(),
  googleOauthClientSecret: z.string().min(1).nullish(),
  turnstileSiteKey: z.string().min(1).nullish(),
  turnstileSecretKey: z.string().min(1).nullish(),

  gbrainUrl: z.string().min(1).nullish(),
  gbrainAdminToken: z.string().min(1).nullish(),

  twitterClientId: z.string().min(1).nullish(),
  twitterClientSecret: z.string().min(1).nullish(),
  twitterEnabled: z.boolean().nullish(),
  linkedinClientId: z.string().min(1).nullish(),
  linkedinClientSecret: z.string().min(1).nullish(),
  linkedinEnabled: z.boolean().nullish(),
  blueskyEnabled: z.boolean().nullish(),

  // Cloudinary media storage. `.nullish()` so a blob written before these
  // fields existed still parses (missing-key → undefined → normalised to
  // null by the loader).
  cloudinaryCloudName: z.string().min(1).nullish(),
  cloudinaryApiKey: z.string().min(1).nullish(),
  cloudinaryApiSecret: z.string().min(1).nullish(),
  cloudinaryUploadFolder: z.string().min(1).nullish(),
});

export type StoredIntegrationConfig = z.infer<
  typeof StoredIntegrationConfigSchema
>;

// Key used to identify the integration_secrets row in site_setting.
export const INTEGRATION_SECRETS_KEY = "integration_secrets";
