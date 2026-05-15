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
});

export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;

// Fields that the loader encrypts before writing and decrypts on read.
// Authoritative list — every encrypt/decrypt call sites should consult
// this rather than hard-coding key names.
export const ENCRYPTED_FIELDS = [
  "adminPassword",
  "resendApiKey",
  "llmApiKey",
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
} as const satisfies Pick<
  IntegrationConfig,
  "contactRecipientEmail" | "resendFromEmail" | "llmModelId"
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
});

export type StoredIntegrationConfig = z.infer<
  typeof StoredIntegrationConfigSchema
>;

// Key used to identify the integration_secrets row in site_setting.
export const INTEGRATION_SECRETS_KEY = "integration_secrets";
