import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt } from "./booking-crypto";
import {
  IntegrationConfigSchema,
  StoredIntegrationConfigSchema,
  ENCRYPTED_FIELDS,
  CONFIG_DEFAULTS,
  isEncryptedField,
} from "./integration-config-shared";
import {
  _decryptAndValidate,
  _readFromEnv,
  _isFallbackEnabled,
} from "./integration-config";
import {
  IntegrationConfigDecryptError,
  IntegrationConfigValidationError,
} from "./errors/integration-config";

// Contract being tested:
//   - getIntegrationConfig returns a fully-decrypted, fully-validated config
//   - Fail-closed on any decrypt failure (never silently substitutes a default)
//   - Grace-window env fallback only when explicitly enabled
//   - Cache survives concurrent reads (single DB query)
//
// We unit-test the pure decision functions directly via the _-prefixed
// exports rather than mocking Drizzle's chainable API, which is awkward
// and brittle. The integration test (separate file, runs against a real
// dev DB) covers getIntegrationConfig() end-to-end.

// 32-byte random key shared across tests in this file. We set it as the
// env var because lib/booking-crypto.getKey() reads from env at call
// time (by design — see that file's comment).
const TEST_KEY = randomBytes(32);
const TEST_KEY_BASE64 = TEST_KEY.toString("base64");

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Build a stored-shape blob with encrypted secret fields + plaintext config. */
function buildStored(overrides: Record<string, unknown> = {}) {
  return {
    adminPassword: encrypt("the-real-admin-password", TEST_KEY),
    resendApiKey: encrypt("re_test_key_abc123", TEST_KEY),
    llmApiKey: encrypt("sk-or-test-xyz789", TEST_KEY),
    contactRecipientEmail: "rob@archoslabs.xyz",
    resendFromEmail: "Archos Labs <hello@archoslabs.xyz>",
    llmModelId: null,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.BOOKING_ENCRYPTION_KEY = TEST_KEY_BASE64;
  delete process.env.INTEGRATION_FALLBACK_ENABLED;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.RESEND_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.CONTACT_RECIPIENT_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.CLAUDE_MODEL_ID;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ----------------------------------------------------------------------------
// Shared schema invariants
// ----------------------------------------------------------------------------

describe("integration-config-shared", () => {
  describe("ENCRYPTED_FIELDS", () => {
    it("covers exactly the secret fields (catches accidental field drift)", () => {
      // If a new field is added to IntegrationConfigSchema and intended
      // to be encrypted, ENCRYPTED_FIELDS must be updated to match.
      expect([...ENCRYPTED_FIELDS]).toEqual([
        "adminPassword",
        "resendApiKey",
        "llmApiKey",
        "googleOauthClientSecret",
        "turnstileSecretKey",
      ]);
    });

    it("isEncryptedField narrows correctly for every key", () => {
      expect(isEncryptedField("adminPassword")).toBe(true);
      expect(isEncryptedField("resendApiKey")).toBe(true);
      expect(isEncryptedField("llmApiKey")).toBe(true);
      expect(isEncryptedField("googleOauthClientSecret")).toBe(true);
      expect(isEncryptedField("turnstileSecretKey")).toBe(true);
      expect(isEncryptedField("contactRecipientEmail")).toBe(false);
      expect(isEncryptedField("resendFromEmail")).toBe(false);
      expect(isEncryptedField("llmModelId")).toBe(false);
      expect(isEncryptedField("googleOauthClientId")).toBe(false);
      expect(isEncryptedField("turnstileSiteKey")).toBe(false);
    });
  });

  describe("IntegrationConfigSchema", () => {
    it("accepts a valid decrypted config", () => {
      const valid = {
        adminPassword: "strong-password-123",
        resendApiKey: "re_abc",
        llmApiKey: "sk-or-xyz",
        contactRecipientEmail: "rob@archoslabs.xyz",
        resendFromEmail: "Archos Labs <hello@archoslabs.xyz>",
        llmModelId: null,
        googleOauthClientId: null,
        googleOauthClientSecret: null,
        turnstileSiteKey: null,
        turnstileSecretKey: null,
      };
      expect(IntegrationConfigSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects an admin password shorter than 8 chars (security floor)", () => {
      const result = IntegrationConfigSchema.safeParse({
        adminPassword: "short",
        resendApiKey: "re_abc",
        llmApiKey: "sk-or-xyz",
        contactRecipientEmail: "rob@archoslabs.xyz",
        resendFromEmail: "hello@archoslabs.xyz",
        llmModelId: null,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["adminPassword"]);
      }
    });

    it("rejects an invalid recipient email", () => {
      const result = IntegrationConfigSchema.safeParse({
        adminPassword: "strong-password-123",
        resendApiKey: "re_abc",
        llmApiKey: "sk-or-xyz",
        contactRecipientEmail: "not-an-email",
        resendFromEmail: "hello@archoslabs.xyz",
        llmModelId: null,
      });
      expect(result.success).toBe(false);
    });

    it("accepts null llmModelId (sentinel for in-code default)", () => {
      const valid = {
        adminPassword: "strong-password-123",
        resendApiKey: "re_abc",
        llmApiKey: "sk-or-xyz",
        contactRecipientEmail: "rob@archoslabs.xyz",
        resendFromEmail: "hello@archoslabs.xyz",
        llmModelId: null,
        googleOauthClientId: null,
        googleOauthClientSecret: null,
        turnstileSiteKey: null,
        turnstileSecretKey: null,
      };
      const parsed = IntegrationConfigSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.llmModelId).toBeNull();
      }
    });

    it("accepts an explicit model id override", () => {
      const valid = {
        adminPassword: "strong-password-123",
        resendApiKey: "re_abc",
        llmApiKey: "sk-or-xyz",
        contactRecipientEmail: "rob@archoslabs.xyz",
        resendFromEmail: "hello@archoslabs.xyz",
        llmModelId: "anthropic/claude-sonnet-4-6",
        googleOauthClientId: null,
        googleOauthClientSecret: null,
        turnstileSiteKey: null,
        turnstileSecretKey: null,
      };
      const parsed = IntegrationConfigSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.llmModelId).toBe(
          "anthropic/claude-sonnet-4-6",
        );
      }
    });
  });

  describe("StoredIntegrationConfigSchema", () => {
    it("accepts a stored blob with non-empty strings for every encrypted field", () => {
      const stored = buildStored();
      expect(StoredIntegrationConfigSchema.safeParse(stored).success).toBe(
        true,
      );
    });

    it("rejects a stored blob with empty ciphertext (signals tampering)", () => {
      const stored = buildStored({ resendApiKey: "" });
      expect(StoredIntegrationConfigSchema.safeParse(stored).success).toBe(
        false,
      );
    });

    it("rejects a stored blob missing a required field", () => {
      const stored = buildStored();
      delete (stored as Record<string, unknown>).adminPassword;
      expect(StoredIntegrationConfigSchema.safeParse(stored).success).toBe(
        false,
      );
    });
  });
});

// ----------------------------------------------------------------------------
// decryptAndValidate — the pure decision function
// ----------------------------------------------------------------------------

describe("decryptAndValidate", () => {
  it("decrypts every encrypted field and returns a typed config (happy path)", () => {
    const stored = buildStored();
    const config = _decryptAndValidate(stored);
    expect(config.adminPassword).toBe("the-real-admin-password");
    expect(config.resendApiKey).toBe("re_test_key_abc123");
    expect(config.llmApiKey).toBe("sk-or-test-xyz789");
    expect(config.contactRecipientEmail).toBe("rob@archoslabs.xyz");
    expect(config.resendFromEmail).toBe(
      "Archos Labs <hello@archoslabs.xyz>",
    );
    expect(config.llmModelId).toBeNull();
  });

  it("throws IntegrationConfigDecryptError when ciphertext is tampered with", () => {
    const stored = buildStored();
    // Flip a byte in the ciphertext base64. Auth tag check inside GCM
    // catches this and our wrapper converts it to a typed error.
    const tampered = encrypt("legitimate-value", TEST_KEY);
    const flipped =
      tampered.slice(0, -4) +
      (tampered.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    stored.resendApiKey = flipped;
    expect(() => _decryptAndValidate(stored)).toThrow(
      IntegrationConfigDecryptError,
    );
  });

  it("throws IntegrationConfigDecryptError when ciphertext was encrypted with a different key", () => {
    const otherKey = randomBytes(32);
    const stored = buildStored({
      // Encrypt with a key that's NOT in env. Decrypt with the env key
      // (different) should fail and surface as our typed error.
      resendApiKey: encrypt("value", otherKey),
    });
    expect(() => _decryptAndValidate(stored)).toThrow(
      IntegrationConfigDecryptError,
    );
  });

  it("does NOT silently substitute a default when decrypt fails (security floor)", () => {
    // Critical fail-closed test. If decrypt fails, we throw — we do NOT
    // continue with an empty string or fall back to env. This is the
    // single most important invariant in the loader.
    const stored = buildStored({ adminPassword: "not-real-base64-!!!" });
    expect(() => _decryptAndValidate(stored)).toThrow(
      IntegrationConfigDecryptError,
    );
  });

  it("throws IntegrationConfigValidationError when the stored shape is malformed", () => {
    const malformed = { adminPassword: "ciphertext-only" }; // missing the rest
    expect(() => _decryptAndValidate(malformed)).toThrow(
      IntegrationConfigValidationError,
    );
  });

  it("throws IntegrationConfigValidationError when decrypted password is too short", () => {
    const stored = buildStored({
      // Encrypt a value that decrypts to something the IntegrationConfig
      // schema rejects (<8 chars). Decryption succeeds; validation fails.
      adminPassword: encrypt("short", TEST_KEY),
    });
    expect(() => _decryptAndValidate(stored)).toThrow(
      IntegrationConfigValidationError,
    );
  });

  it("surfaces the failing field name in the validation error", () => {
    const stored = buildStored({
      adminPassword: encrypt("short", TEST_KEY),
    });
    try {
      _decryptAndValidate(stored);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(IntegrationConfigValidationError);
      if (err instanceof IntegrationConfigValidationError) {
        expect(err.fields).toContain("adminPassword");
      }
    }
  });
});

// ----------------------------------------------------------------------------
// Grace-window env fallback
// ----------------------------------------------------------------------------

describe("env-fallback grace window", () => {
  it("isFallbackEnabled returns true only when INTEGRATION_FALLBACK_ENABLED=true", () => {
    delete process.env.INTEGRATION_FALLBACK_ENABLED;
    expect(_isFallbackEnabled()).toBe(false);

    process.env.INTEGRATION_FALLBACK_ENABLED = "true";
    expect(_isFallbackEnabled()).toBe(true);

    process.env.INTEGRATION_FALLBACK_ENABLED = "false";
    expect(_isFallbackEnabled()).toBe(false);

    process.env.INTEGRATION_FALLBACK_ENABLED = "1"; // truthy but not literal "true"
    expect(_isFallbackEnabled()).toBe(false);
  });

  it("readFromEnv returns a fully-typed config when every env var is set", () => {
    process.env.ADMIN_PASSWORD = "real-admin-password";
    process.env.RESEND_API_KEY = "re_real";
    process.env.OPENROUTER_API_KEY = "sk-or-real";
    process.env.CONTACT_RECIPIENT_EMAIL = "rob@example.com";
    process.env.RESEND_FROM_EMAIL = "hello@example.com";

    const config = _readFromEnv();
    expect(config.adminPassword).toBe("real-admin-password");
    expect(config.resendApiKey).toBe("re_real");
    expect(config.llmApiKey).toBe("sk-or-real");
    expect(config.contactRecipientEmail).toBe("rob@example.com");
    expect(config.resendFromEmail).toBe("hello@example.com");
  });

  it("readFromEnv uses CONFIG_DEFAULTS when an optional config var is missing", () => {
    process.env.ADMIN_PASSWORD = "real-admin-password";
    process.env.RESEND_API_KEY = "re_real";
    process.env.OPENROUTER_API_KEY = "sk-or-real";
    // Intentionally omit contactRecipientEmail and resendFromEmail.

    const config = _readFromEnv();
    expect(config.contactRecipientEmail).toBe(
      CONFIG_DEFAULTS.contactRecipientEmail,
    );
    expect(config.resendFromEmail).toBe(CONFIG_DEFAULTS.resendFromEmail);
  });

  it("readFromEnv throws when a required secret is missing", () => {
    // No env vars set for ADMIN_PASSWORD / RESEND_API_KEY / OPENROUTER_API_KEY.
    // Schema rejects empty strings via min(1) and min(8) for adminPassword.
    expect(() => _readFromEnv()).toThrow(IntegrationConfigValidationError);
  });
});
