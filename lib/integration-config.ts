import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { siteSetting, integrationSecretAudit } from "./db/schema";
import { encrypt, decrypt, getKey } from "./booking-crypto";
import {
  IntegrationConfigSchema,
  StoredIntegrationConfigSchema,
  ENCRYPTED_FIELDS,
  CONFIG_DEFAULTS,
  INTEGRATION_SECRETS_KEY,
  type IntegrationConfig,
} from "./integration-config-shared";
import {
  MasterKeyMissingError,
  IntegrationConfigNotFoundError,
  IntegrationConfigDecryptError,
  IntegrationConfigValidationError,
} from "./errors/integration-config";
import { CryptoError } from "./errors/booking";

// Server-side loader for the integration_secrets row. Reads from the
// site_setting table, decrypts per-field with the master key from
// BOOKING_ENCRYPTION_KEY, validates with Zod, returns a typed config
// object. Module-level cache means zero per-request DB overhead in
// steady state.
//
// Failure model:
//   - Master key missing                 → MasterKeyMissingError, exit
//   - DB unreachable                     → propagates DB driver error
//   - Row missing + grace enabled        → falls back to env vars
//   - Row missing + grace disabled       → IntegrationConfigNotFoundError
//   - Stored shape malformed             → IntegrationConfigValidationError
//   - Any encrypted field fails to decrypt → IntegrationConfigDecryptError
//     (NEVER falls back to env on this — see error-class comments)
//   - Decrypted shape fails Zod          → IntegrationConfigValidationError
//
// Cache:
//   - Promise-based so concurrent first-call requests share one DB query
//   - clearIntegrationConfigCache() invalidates; called by writers and tests
//   - On error, cache is cleared so the next call retries (production
//     should exit anyway; this is for test ergonomics)
//
// Single-instance assumption: cache invalidation is in-process only. Works
// because Render web service runs one container. Multi-instance would
// require a pub/sub or version-poll mechanism — flagged for future
// in wiki/concepts/integration-config.md.

let cachedConfigPromise: Promise<IntegrationConfig> | null = null;

/**
 * Returns the live integration config. Reads from DB on first call,
 * returns cached value thereafter. Cache survives until invalidated
 * (writer call) or process restart.
 *
 * Throws: MasterKeyMissingError, IntegrationConfigNotFoundError,
 * IntegrationConfigDecryptError, IntegrationConfigValidationError.
 */
export async function getIntegrationConfig(): Promise<IntegrationConfig> {
  if (cachedConfigPromise) return cachedConfigPromise;

  cachedConfigPromise = loadAndDecrypt().catch((err) => {
    // Clear so the next call retries. Production callers should exit
    // anyway; this is for tests that mock failure → success transitions.
    cachedConfigPromise = null;
    throw err;
  });
  return cachedConfigPromise;
}

/**
 * Explicit cache invalidation. Called by every writer
 * (updateIntegrationSecret, rotateMasterKey, migrateEnvToDB) and by
 * tests between assertions.
 */
export function clearIntegrationConfigCache(): void {
  cachedConfigPromise = null;
}

async function loadAndDecrypt(): Promise<IntegrationConfig> {
  // Read master key first — bare process.env access throws
  // MasterKeyMissingError via the existing booking-crypto getKey().
  // Catches the case where we're in a fresh deployment with the env
  // var missing before any DB I/O is wasted.
  try {
    getKey();
  } catch (err) {
    if (err instanceof CryptoError) {
      throw new MasterKeyMissingError(
        "BOOKING_ENCRYPTION_KEY not set — required to decrypt integration_secrets",
        { cause: err },
      );
    }
    throw err;
  }

  const db = getDb();
  const rows = await db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, INTEGRATION_SECRETS_KEY))
    .limit(1);

  if (rows.length === 0) {
    if (isFallbackEnabled()) {
      return readFromEnv();
    }
    throw new IntegrationConfigNotFoundError(
      `No '${INTEGRATION_SECRETS_KEY}' row in site_setting. Run 'pnpm migrate-integration-secrets' to seed.`,
    );
  }

  const rawValue = rows[0].value;
  return decryptAndValidate(rawValue);
}

/**
 * Decode the stored JSONB blob into a typed IntegrationConfig.
 * Encrypted fields are decrypted with the master key; plaintext fields
 * pass through. Both then run through IntegrationConfigSchema for
 * structural validation.
 */
function decryptAndValidate(rawValue: unknown): IntegrationConfig {
  const stored = StoredIntegrationConfigSchema.safeParse(rawValue);
  if (!stored.success) {
    throw new IntegrationConfigValidationError(
      "integration_secrets row has unexpected shape — DB tampering or schema drift",
      stored.error.issues.map((i) => i.path.join(".")),
    );
  }

  const decrypted: Record<string, unknown> = { ...stored.data };
  for (const field of ENCRYPTED_FIELDS) {
    const raw = stored.data[field];
    // Nullable encrypted fields (e.g. googleOauthClientSecret on a fresh
    // install) stay null on the decrypted side; only attempt decrypt
    // when ciphertext is actually present.
    if (raw === undefined || raw === null) {
      decrypted[field] = null;
      continue;
    }
    try {
      decrypted[field] = decrypt(raw);
    } catch (err) {
      // CryptoError class covers tampered ciphertext, wrong key,
      // malformed base64. Any of those means the secret is unreadable
      // and we must NOT silently use a default.
      throw new IntegrationConfigDecryptError(
        `Decrypt failed for '${field}' — wrong master key or tampered ciphertext`,
        { cause: err },
      );
    }
  }

  // Normalise undefined → null on the plaintext nullable fields so
  // IntegrationConfigSchema (.nullable, not .nullish) accepts them.
  if (decrypted.googleOauthClientId === undefined) {
    decrypted.googleOauthClientId = null;
  }
  if (decrypted.turnstileSiteKey === undefined) {
    decrypted.turnstileSiteKey = null;
  }

  const parsed = IntegrationConfigSchema.safeParse(decrypted);
  if (!parsed.success) {
    throw new IntegrationConfigValidationError(
      "Decrypted integration config failed schema validation",
      parsed.error.issues.map((i) => i.path.join(".")),
    );
  }
  return parsed.data;
}

/**
 * Env-fallback path used during the 7-day grace window after migration.
 * Reads each field from the same env var name we'd be removing later.
 * Returns a fully-typed IntegrationConfig or throws if a required
 * secret is missing (secrets have no documented default).
 */
function readFromEnv(): IntegrationConfig {
  // Env-var-name → field-name mapping. The field names are
  // provider-agnostic (llmApiKey, llmModelId) but the env vars retain
  // their historical provider-specific names (OPENROUTER_API_KEY,
  // CLAUDE_MODEL_ID) to avoid Render-dashboard churn.
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const llmApiKey = process.env.OPENROUTER_API_KEY ?? "";

  const config: IntegrationConfig = {
    adminPassword,
    resendApiKey,
    llmApiKey,
    contactRecipientEmail:
      process.env.CONTACT_RECIPIENT_EMAIL ??
      CONFIG_DEFAULTS.contactRecipientEmail,
    resendFromEmail:
      process.env.RESEND_FROM_EMAIL ?? CONFIG_DEFAULTS.resendFromEmail,
    llmModelId: process.env.CLAUDE_MODEL_ID ?? CONFIG_DEFAULTS.llmModelId,
    // Google OAuth env fallback. Empty string → null so the schema's
    // `.min(1).nullable()` accepts "not configured."
    googleOauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || null,
    googleOauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || null,
    // Turnstile keys never lived in env historically — null in fallback.
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || null,
  };

  const parsed = IntegrationConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new IntegrationConfigValidationError(
      "Env-fallback config is missing required values — set env vars or run migration",
      parsed.error.issues.map((i) => i.path.join(".")),
    );
  }
  return parsed.data;
}

/**
 * Controls the 7-day env-fallback grace window. Flip
 * INTEGRATION_FALLBACK_ENABLED=true on Render dashboard during the
 * transition, false (or remove) after stable verification.
 */
function isFallbackEnabled(): boolean {
  return process.env.INTEGRATION_FALLBACK_ENABLED === "true";
}

// ----------------------------------------------------------------------------
// Writers
// ----------------------------------------------------------------------------

export type UpdateActor = string;

/**
 * Update a single field in the integration config. Encrypts if the
 * field is in ENCRYPTED_FIELDS. Atomic: read-modify-write inside one
 * transaction; audit-log row written in same tx. Invalidates the
 * in-process cache so the next read sees the new value.
 *
 * Caller responsibility: validate the new value against the relevant
 * Zod field before calling (e.g. an email field passes z.email()).
 */
export async function updateIntegrationSecret<
  K extends keyof IntegrationConfig,
>(
  field: K,
  newValue: IntegrationConfig[K],
  actor: UpdateActor = "admin",
): Promise<void> {
  // Validate field-level: run the field's Zod check by re-running the
  // full schema with a partial. We rely on the parent schema's safeParse
  // for field-level constraints; this catches "passed an empty string
  // for resendApiKey" before any DB I/O.
  const fieldSchema = IntegrationConfigSchema.shape[field];
  const fieldParsed = fieldSchema.safeParse(newValue);
  if (!fieldParsed.success) {
    throw new IntegrationConfigValidationError(
      `Validation failed for field '${field}'`,
      [String(field)],
    );
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    // Read current row (or initialise if missing).
    const existing = await tx
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, INTEGRATION_SECRETS_KEY))
      .limit(1);

    const currentStored = existing[0]?.value as Record<string, unknown> | undefined;

    // Build the new stored shape. For encrypted fields, encrypt now;
    // for plaintext fields, write through.
    const isEncrypted = (ENCRYPTED_FIELDS as readonly string[]).includes(
      String(field),
    );
    const newStoredValue = isEncrypted
      ? encrypt(String(fieldParsed.data))
      : fieldParsed.data;

    const merged = {
      ...(currentStored ?? {}),
      [field]: newStoredValue,
    };

    // Upsert: insert if missing, update if present. Both branches set
    // updated_at via Drizzle's onConflictDoUpdate.
    await tx
      .insert(siteSetting)
      .values({
        key: INTEGRATION_SECRETS_KEY,
        value: merged,
      })
      .onConflictDoUpdate({
        target: siteSetting.key,
        set: { value: merged, updatedAt: new Date() },
      });

    // Audit log row. Operation 'created' for first write, 'updated'
    // otherwise. Never include the value.
    await tx.insert(integrationSecretAudit).values({
      keyName: camelToSnake(String(field)),
      operation: currentStored === undefined ? "created" : "updated",
      actor,
    });
  });

  clearIntegrationConfigCache();
}

/**
 * One-time migration from env vars to the encrypted DB row. Idempotent
 * (running twice is safe). Reads every expected env var, encrypts the
 * secrets, writes a single integration_secrets row. Skips silently if
 * an env var is missing (logs a warning) — this lets you migrate
 * partially and finish later from the admin UI.
 *
 * Returns an array of fields that were written (so the CLI script can
 * print a clear summary).
 */
export async function migrateEnvToDB(): Promise<{
  written: Array<keyof IntegrationConfig>;
  skipped: Array<keyof IntegrationConfig>;
}> {
  // Verify the master key is set before reading anything.
  try {
    getKey();
  } catch (err) {
    if (err instanceof CryptoError) {
      throw new MasterKeyMissingError(
        "BOOKING_ENCRYPTION_KEY not set — cannot encrypt secrets for migration",
        { cause: err },
      );
    }
    throw err;
  }

  // Same env-var-name → field-name mapping as readFromEnv().
  // llmApiKey ← OPENROUTER_API_KEY, llmModelId ← CLAUDE_MODEL_ID.
  const envValues: Record<keyof IntegrationConfig, string | null> = {
    adminPassword: process.env.ADMIN_PASSWORD ?? null,
    resendApiKey: process.env.RESEND_API_KEY ?? null,
    llmApiKey: process.env.OPENROUTER_API_KEY ?? null,
    contactRecipientEmail: process.env.CONTACT_RECIPIENT_EMAIL ?? null,
    resendFromEmail: process.env.RESEND_FROM_EMAIL ?? null,
    llmModelId: process.env.CLAUDE_MODEL_ID ?? null,
    googleOauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? null,
    googleOauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? null,
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? null,
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? null,
  };

  const written: Array<keyof IntegrationConfig> = [];
  const skipped: Array<keyof IntegrationConfig> = [];

  const db = getDb();
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, INTEGRATION_SECRETS_KEY))
      .limit(1);
    const currentStored =
      (existing[0]?.value as Record<string, unknown> | undefined) ?? {};

    const merged: Record<string, unknown> = { ...currentStored };

    for (const [key, raw] of Object.entries(envValues) as Array<
      [keyof IntegrationConfig, string | null]
    >) {
      if (raw === null || raw === "") {
        skipped.push(key);
        continue;
      }
      const isEncrypted = (ENCRYPTED_FIELDS as readonly string[]).includes(key);
      merged[key] = isEncrypted ? encrypt(raw) : raw;
      written.push(key);
    }

    // Default the config fields so the row passes StoredIntegrationConfigSchema
    // even if the corresponding env var was missing.
    if (merged.contactRecipientEmail === undefined) {
      merged.contactRecipientEmail = CONFIG_DEFAULTS.contactRecipientEmail;
    }
    if (merged.resendFromEmail === undefined) {
      merged.resendFromEmail = CONFIG_DEFAULTS.resendFromEmail;
    }
    if (merged.llmModelId === undefined) {
      merged.llmModelId = CONFIG_DEFAULTS.llmModelId;
    }

    await tx
      .insert(siteSetting)
      .values({
        key: INTEGRATION_SECRETS_KEY,
        value: merged,
      })
      .onConflictDoUpdate({
        target: siteSetting.key,
        set: { value: merged, updatedAt: new Date() },
      });

    // One audit row per actually-written field, marked 'created' since
    // the migration is the first write to that key.
    for (const key of written) {
      await tx.insert(integrationSecretAudit).values({
        keyName: camelToSnake(String(key)),
        operation: "created",
        actor: "migration",
      });
    }
  });

  clearIntegrationConfigCache();
  return { written, skipped };
}

/**
 * Re-encrypt all encrypted fields with a new master key. Atomic:
 * read with old key, decrypt, re-encrypt with new key, write back —
 * all inside one transaction. If the process is killed mid-way, the
 * original row is preserved (transaction rolls back).
 *
 * The caller must rotate BOOKING_ENCRYPTION_KEY in env AFTER this
 * returns successfully, then restart. Doing it before leaves the app
 * unable to decrypt the current row.
 */
export async function rotateMasterKey(
  oldKeyBase64: string,
  newKeyBase64: string,
): Promise<{ fieldsRotated: number }> {
  const oldKey = Buffer.from(oldKeyBase64, "base64");
  const newKey = Buffer.from(newKeyBase64, "base64");
  if (oldKey.length !== 32 || newKey.length !== 32) {
    throw new MasterKeyMissingError(
      "Both old and new master keys must decode to 32 bytes (base64)",
    );
  }

  let fieldsRotated = 0;
  const db = getDb();
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, INTEGRATION_SECRETS_KEY))
      .limit(1);

    if (existing.length === 0) {
      throw new IntegrationConfigNotFoundError(
        "No integration_secrets row to rotate. Run migrate-integration-secrets first.",
      );
    }

    const stored = StoredIntegrationConfigSchema.parse(existing[0].value);

    const rotated: Record<string, unknown> = { ...stored };
    for (const field of ENCRYPTED_FIELDS) {
      const raw = stored[field];
      // Nullable encrypted fields (e.g. googleOauthClientSecret pre-config)
      // have nothing to rotate — skip.
      if (raw === undefined || raw === null) continue;
      let plaintext: string;
      try {
        plaintext = decrypt(raw, oldKey);
      } catch (err) {
        throw new IntegrationConfigDecryptError(
          `Old master key cannot decrypt field '${field}' — wrong --old key?`,
          { cause: err },
        );
      }
      rotated[field] = encrypt(plaintext, newKey);
      fieldsRotated++;
    }

    await tx
      .update(siteSetting)
      .set({ value: rotated, updatedAt: new Date() })
      .where(eq(siteSetting.key, INTEGRATION_SECRETS_KEY));

    // Single audit row signalling the whole-row rotation. keyName uses
    // a sentinel so this row is filterable from per-field updates.
    await tx.insert(integrationSecretAudit).values({
      keyName: "_master_key",
      operation: "rotated_master_key",
      actor: "admin",
    });
  });

  clearIntegrationConfigCache();
  return { fieldsRotated };
}

// camelCase → snake_case for audit log key_name column (matches the
// DB-naming convention even though the JSONB blob itself stores camel).
function camelToSnake(input: string): string {
  return input.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/**
 * Produce a redacted display string for a secret value. Shows 8 bullets
 * + last 4 chars so the admin can visually distinguish "did I rotate
 * this key?" without exposing the secret. Short secrets (< 5 chars)
 * fully redact.
 */
export function redactSecret(plaintext: string): string {
  if (!plaintext) return "";
  if (plaintext.length <= 4) return "•".repeat(plaintext.length);
  return `••••••••${plaintext.slice(-4)}`;
}

/**
 * Admin-safe view of the integration config: secrets are redacted to
 * `••••••••3a72` form, config fields pass through. Used by the GET
 * /api/admin/integrations endpoint so the page can render without
 * ever shipping plaintext secrets to the client.
 */
export async function getIntegrationConfigRedacted(): Promise<{
  adminPassword: string;
  resendApiKey: string;
  llmApiKey: string;
  contactRecipientEmail: string;
  resendFromEmail: string;
  llmModelId: string | null;
  googleOauthClientId: string | null;
  googleOauthClientSecret: string;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string;
}> {
  const config = await getIntegrationConfig();
  return {
    adminPassword: redactSecret(config.adminPassword),
    resendApiKey: redactSecret(config.resendApiKey),
    llmApiKey: redactSecret(config.llmApiKey),
    contactRecipientEmail: config.contactRecipientEmail,
    resendFromEmail: config.resendFromEmail,
    llmModelId: config.llmModelId,
    // Client ID is identifier-grade — surface the full value so the
    // admin can confirm it matches the Google Cloud Console panel.
    googleOauthClientId: config.googleOauthClientId,
    // Client Secret is the real credential — always redact (empty when null).
    googleOauthClientSecret: redactSecret(config.googleOauthClientSecret ?? ""),
    // Site key is rendered into HTML — surface plaintext so the admin
    // can confirm what's deployed. Secret key always redacted.
    turnstileSiteKey: config.turnstileSiteKey,
    turnstileSecretKey: redactSecret(config.turnstileSecretKey ?? ""),
  };
}

// ----------------------------------------------------------------------------
// Test-only exports
// ----------------------------------------------------------------------------
// Underscore-prefixed re-exports of internal pure functions so unit tests
// can exercise the decrypt/validate path without setting up a real DB.
// Production callers should always go through getIntegrationConfig().

export {
  decryptAndValidate as _decryptAndValidate,
  readFromEnv as _readFromEnv,
  isFallbackEnabled as _isFallbackEnabled,
  clearIntegrationConfigCache as _resetCache,
};
