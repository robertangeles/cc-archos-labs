import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { authSetting } from "../db/schema";
import { decrypt, encrypt } from "../booking-crypto";
import { CryptoError } from "../errors/booking";

// auth_setting service. Owns serialization + at-rest encryption for the
// admin-managed authentication config (T8). Mirrors the site_setting
// shape — one row per logical setting, value held as JSONB.
//
// Encryption strategy: secret keys are encrypted with AES-256-GCM via
// lib/booking-crypto.ts (same BOOKING_ENCRYPTION_KEY env var as the
// Google refresh-token encryption). Reusing the key is intentional —
// both are server-side at-rest encryption for admin-managed secrets;
// separating into a second key would require a second env-var setup
// without meaningfully reducing blast radius.
//
// Reads ALWAYS return a redacted view (`hasSecret: boolean` instead of
// the secret value). The actual secret is only ever decrypted inside
// the helpers that need it at request time (lib/auth/turnstile.ts).
//
// Writes accept fields-shaped patches. Empty-string secret fields are
// IGNORED (not stored as empty). To clear a secret, send `null`.

// Logical keys + their JSONB value shapes.
const KEYS = {
  TURNSTILE_ENABLED: "turnstile_enabled",
  TURNSTILE_SITE_KEY: "turnstile_site_key",
  TURNSTILE_SECRET_KEY: "turnstile_secret_key_encrypted",
  PUBLIC_SIGNUP_ENABLED: "public_signup_enabled",
  // T8b additions (Google OAuth UI):
  GOOGLE_OAUTH_ENABLED: "google_oauth_enabled",
  GOOGLE_CLIENT_ID: "google_client_id",
  GOOGLE_CLIENT_SECRET: "google_client_secret_encrypted",
} as const;

export interface AuthSettingsView {
  /** Whether Cloudflare Turnstile is enabled. Default false. */
  turnstileEnabled: boolean;
  /** Public site key (non-secret, OK to render). Empty when unset. */
  turnstileSiteKey: string;
  /** Whether a secret is configured. Never returns the actual value. */
  turnstileHasSecret: boolean;
  /** Whether public sign-up is enabled. Default false. */
  publicSignupEnabled: boolean;
  /** Whether Google sign-in is enabled. Default false. */
  googleOauthEnabled: boolean;
  /** Google OAuth client id (public, OK to render). Empty when unset. */
  googleClientId: string;
  /** Whether a Google client secret is configured. Never returns value. */
  googleHasClientSecret: boolean;
}

export interface AuthSettingsPatch {
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null; // null clears; empty string ignored
  /** New secret value to store. Empty string ignored. null clears. */
  turnstileSecretKey?: string | null;
  publicSignupEnabled?: boolean;
  googleOauthEnabled?: boolean;
  googleClientId?: string | null;
  googleClientSecret?: string | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface RawRow {
  key: string;
  value: unknown;
}

async function loadAllRows(): Promise<Map<string, unknown>> {
  const db = getDb();
  const rows = (await db
    .select({ key: authSetting.key, value: authSetting.value })
    .from(authSetting)) as RawRow[];
  const map = new Map<string, unknown>();
  for (const r of rows) map.set(r.key, r.value);
  return map;
}

function readBool(value: unknown): boolean {
  if (value && typeof value === "object" && "enabled" in value) {
    return Boolean((value as { enabled?: unknown }).enabled);
  }
  return false;
}

function readString(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    const v = (value as { value?: unknown }).value;
    return typeof v === "string" ? v : "";
  }
  return "";
}

function readEncryptedPresence(value: unknown): boolean {
  if (value && typeof value === "object" && "ciphertext" in value) {
    const ct = (value as { ciphertext?: unknown }).ciphertext;
    return typeof ct === "string" && ct.length > 0;
  }
  return false;
}

/** Returns the redacted current settings. Never reveals secrets. */
export async function getAuthSettings(): Promise<AuthSettingsView> {
  const rows = await loadAllRows();
  return {
    turnstileEnabled: readBool(rows.get(KEYS.TURNSTILE_ENABLED)),
    turnstileSiteKey: readString(rows.get(KEYS.TURNSTILE_SITE_KEY)),
    turnstileHasSecret: readEncryptedPresence(
      rows.get(KEYS.TURNSTILE_SECRET_KEY),
    ),
    publicSignupEnabled: readBool(rows.get(KEYS.PUBLIC_SIGNUP_ENABLED)),
    googleOauthEnabled: readBool(rows.get(KEYS.GOOGLE_OAUTH_ENABLED)),
    googleClientId: readString(rows.get(KEYS.GOOGLE_CLIENT_ID)),
    googleHasClientSecret: readEncryptedPresence(
      rows.get(KEYS.GOOGLE_CLIENT_SECRET),
    ),
  };
}

async function getEncryptedSecretPlain(
  key: string,
  label: string,
): Promise<string | null> {
  const rows = await loadAllRows();
  const raw = rows.get(key);
  if (!raw || typeof raw !== "object" || !("ciphertext" in raw)) return null;
  const ct = (raw as { ciphertext?: unknown }).ciphertext;
  if (typeof ct !== "string" || ct.length === 0) return null;
  try {
    return decrypt(ct);
  } catch (err) {
    if (err instanceof CryptoError) {
      console.error(`[auth/settings] ${label} decrypt failed:`, err.message);
      return null;
    }
    throw err;
  }
}

/**
 * Internal — returns the plaintext Turnstile secret OR null if unset.
 * Called by lib/auth/turnstile.ts at verify time, never by route
 * handlers responding to the admin UI.
 */
export async function getTurnstileSecretPlain(): Promise<string | null> {
  return getEncryptedSecretPlain(
    KEYS.TURNSTILE_SECRET_KEY,
    "turnstile secret",
  );
}

/**
 * Internal — returns the plaintext Google OAuth client secret OR null
 * if unset. Called by lib/auth/oauth-google.ts at the OAuth-dance
 * boundary, never by route handlers responding to the admin UI.
 */
export async function getGoogleClientSecretPlain(): Promise<string | null> {
  return getEncryptedSecretPlain(
    KEYS.GOOGLE_CLIENT_SECRET,
    "google client secret",
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function upsertRow(key: string, value: unknown): Promise<void> {
  const db = getDb();
  // Two-step: try update, fall back to insert. Postgres ON CONFLICT
  // would be cleaner but Drizzle's onConflictDoUpdate syntax adds churn
  // and this is admin-side, not hot path.
  const updated = await db
    .update(authSetting)
    .set({ value: value as object, updatedAt: new Date() })
    .where(eq(authSetting.key, key))
    .returning({ id: authSetting.id });
  if (updated.length === 0) {
    await db.insert(authSetting).values({ key, value: value as object });
  }
}

/**
 * Apply a partial update to the auth settings. Empty strings are
 * IGNORED for string fields — to clear a value, send `null` explicitly.
 * Boolean fields are applied as-is. Secret fields are encrypted before
 * storage.
 *
 * Returns the new redacted view (matching getAuthSettings()).
 */
export async function updateAuthSettings(
  patch: AuthSettingsPatch,
): Promise<AuthSettingsView> {
  if (patch.turnstileEnabled !== undefined) {
    await upsertRow(KEYS.TURNSTILE_ENABLED, { enabled: patch.turnstileEnabled });
  }
  if (patch.turnstileSiteKey !== undefined) {
    if (patch.turnstileSiteKey === null) {
      await upsertRow(KEYS.TURNSTILE_SITE_KEY, { value: "" });
    } else if (patch.turnstileSiteKey.length > 0) {
      await upsertRow(KEYS.TURNSTILE_SITE_KEY, {
        value: patch.turnstileSiteKey,
      });
    }
    // Empty string: ignore — UI form field will be empty when secret
    // is set, don't accidentally overwrite.
  }
  if (patch.turnstileSecretKey !== undefined) {
    if (patch.turnstileSecretKey === null) {
      await upsertRow(KEYS.TURNSTILE_SECRET_KEY, { ciphertext: "" });
    } else if (patch.turnstileSecretKey.length > 0) {
      const ciphertext = encrypt(patch.turnstileSecretKey);
      await upsertRow(KEYS.TURNSTILE_SECRET_KEY, { ciphertext });
    }
  }
  if (patch.publicSignupEnabled !== undefined) {
    await upsertRow(KEYS.PUBLIC_SIGNUP_ENABLED, {
      enabled: patch.publicSignupEnabled,
    });
  }
  if (patch.googleOauthEnabled !== undefined) {
    await upsertRow(KEYS.GOOGLE_OAUTH_ENABLED, {
      enabled: patch.googleOauthEnabled,
    });
  }
  if (patch.googleClientId !== undefined) {
    if (patch.googleClientId === null) {
      await upsertRow(KEYS.GOOGLE_CLIENT_ID, { value: "" });
    } else if (patch.googleClientId.length > 0) {
      await upsertRow(KEYS.GOOGLE_CLIENT_ID, { value: patch.googleClientId });
    }
  }
  if (patch.googleClientSecret !== undefined) {
    if (patch.googleClientSecret === null) {
      await upsertRow(KEYS.GOOGLE_CLIENT_SECRET, { ciphertext: "" });
    } else if (patch.googleClientSecret.length > 0) {
      const ciphertext = encrypt(patch.googleClientSecret);
      await upsertRow(KEYS.GOOGLE_CLIENT_SECRET, { ciphertext });
    }
  }
  return getAuthSettings();
}
