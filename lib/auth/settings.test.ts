import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Generated once per test run — a valid 32-byte base64 key for the
// AES-256-GCM encrypt/decrypt round-trip in booking-crypto.ts.
const TEST_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const {
  selectMock,
  updateExecMock,
  insertExecMock,
  // Live capture of stored rows so a SELECT after an UPDATE returns
  // the new value. Lets us test the round-trip.
  storedRowsRef,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  updateExecMock: vi.fn(),
  insertExecMock: vi.fn(),
  storedRowsRef: { rows: [] as Array<{ key: string; value: unknown }> },
}));

vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => selectMock(),
    }),
    update: () => ({
      set: (vals: { value: unknown }) => ({
        where: (..._args: unknown[]) => ({
          // settings.ts chains .returning() to detect no-match → fall
          // through to insert. Returning empty array routes to insert.
          returning: () => updateExecMock(vals),
        }),
      }),
    }),
    insert: () => ({
      values: (vals: { key: string; value: unknown }) => {
        storedRowsRef.rows.push({ key: vals.key, value: vals.value });
        return insertExecMock(vals);
      },
    }),
  }),
}));

vi.mock("../db/schema", () => ({
  authSetting: { __tag: "auth_setting" },
}));

import {
  getAuthSettings,
  getTurnstileSecretPlain,
  updateAuthSettings,
} from "./settings";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BOOKING_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  storedRowsRef.rows = [];

  // Default: empty table.
  selectMock.mockResolvedValue([]);
  // Update returns empty (no row matched) so upsert falls through to insert.
  updateExecMock.mockResolvedValue([]);
  insertExecMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("getAuthSettings — defaults when no rows exist", () => {
  it("returns disabled defaults + no secret", async () => {
    const r = await getAuthSettings();
    expect(r).toEqual({
      turnstileEnabled: false,
      turnstileSiteKey: "",
      turnstileHasSecret: false,
      publicSignupEnabled: false,
    });
  });
});

describe("getAuthSettings — reads stored rows", () => {
  it("parses bool / string / encrypted-presence shapes", async () => {
    selectMock.mockResolvedValueOnce([
      { key: "turnstile_enabled", value: { enabled: true } },
      { key: "turnstile_site_key", value: { value: "0xSITE" } },
      {
        key: "turnstile_secret_key_encrypted",
        value: { ciphertext: "anything-non-empty" },
      },
      { key: "public_signup_enabled", value: { enabled: true } },
    ]);
    const r = await getAuthSettings();
    expect(r).toEqual({
      turnstileEnabled: true,
      turnstileSiteKey: "0xSITE",
      turnstileHasSecret: true,
      publicSignupEnabled: true,
    });
  });

  it("treats malformed value shapes as defaults (defensive)", async () => {
    selectMock.mockResolvedValueOnce([
      { key: "turnstile_enabled", value: null },
      { key: "turnstile_site_key", value: { value: 42 } }, // wrong type
      { key: "turnstile_secret_key_encrypted", value: { ciphertext: "" } },
    ]);
    const r = await getAuthSettings();
    expect(r.turnstileEnabled).toBe(false);
    expect(r.turnstileSiteKey).toBe("");
    expect(r.turnstileHasSecret).toBe(false);
  });
});

describe("updateAuthSettings", () => {
  it("writes boolean toggles and string site key", async () => {
    await updateAuthSettings({
      turnstileEnabled: true,
      turnstileSiteKey: "0xSITE",
      publicSignupEnabled: false,
    });

    // 3 inserts (table is empty, all upserts fall through to insert).
    expect(insertExecMock).toHaveBeenCalledTimes(3);
    expect(storedRowsRef.rows).toEqual(
      expect.arrayContaining([
        { key: "turnstile_enabled", value: { enabled: true } },
        { key: "turnstile_site_key", value: { value: "0xSITE" } },
        { key: "public_signup_enabled", value: { enabled: false } },
      ]),
    );
  });

  it("encrypts the secret key (never stored in plaintext)", async () => {
    await updateAuthSettings({ turnstileSecretKey: "raw-secret-value" });

    expect(insertExecMock).toHaveBeenCalledTimes(1);
    const stored = storedRowsRef.rows.find(
      (r) => r.key === "turnstile_secret_key_encrypted",
    );
    expect(stored).toBeDefined();
    const ct = (stored?.value as { ciphertext: string }).ciphertext;
    // Must be set + must NOT be the plaintext.
    expect(typeof ct).toBe("string");
    expect(ct.length).toBeGreaterThan(20);
    expect(ct).not.toContain("raw-secret-value");
  });

  it("ignores empty string secret (no overwrite)", async () => {
    await updateAuthSettings({ turnstileSecretKey: "" });
    expect(insertExecMock).not.toHaveBeenCalled();
  });

  it("clears the secret on explicit null", async () => {
    await updateAuthSettings({ turnstileSecretKey: null });
    expect(insertExecMock).toHaveBeenCalledTimes(1);
    const stored = storedRowsRef.rows[0];
    expect(stored.key).toBe("turnstile_secret_key_encrypted");
    expect(stored.value).toEqual({ ciphertext: "" });
  });

  it("ignores empty string site key (no overwrite)", async () => {
    await updateAuthSettings({ turnstileSiteKey: "" });
    expect(insertExecMock).not.toHaveBeenCalled();
  });

  it("clears site key on explicit null", async () => {
    await updateAuthSettings({ turnstileSiteKey: null });
    expect(storedRowsRef.rows[0].value).toEqual({ value: "" });
  });
});

describe("getTurnstileSecretPlain — encryption round-trip", () => {
  it("encrypts on write + decrypts on read", async () => {
    // Phase 1: write the secret. The upsert call inserts a row.
    await updateAuthSettings({ turnstileSecretKey: "real-secret-value" });

    const stored = storedRowsRef.rows.find(
      (r) => r.key === "turnstile_secret_key_encrypted",
    );
    expect(stored).toBeDefined();

    // Phase 2: read it back. Simulate a fresh getDb call where the
    // select returns the stored rows.
    selectMock.mockResolvedValueOnce([
      { key: stored?.key, value: stored?.value },
    ]);

    const plaintext = await getTurnstileSecretPlain();
    expect(plaintext).toBe("real-secret-value");
  });

  it("returns null when no secret row exists", async () => {
    expect(await getTurnstileSecretPlain()).toBeNull();
  });

  it("returns null when ciphertext is empty", async () => {
    selectMock.mockResolvedValueOnce([
      { key: "turnstile_secret_key_encrypted", value: { ciphertext: "" } },
    ]);
    expect(await getTurnstileSecretPlain()).toBeNull();
  });

  it("returns null + logs on decryption failure (tampered ciphertext)", async () => {
    selectMock.mockResolvedValueOnce([
      {
        key: "turnstile_secret_key_encrypted",
        value: { ciphertext: "garbage-not-base64-or-tampered" },
      },
    ]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getTurnstileSecretPlain()).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });
});
