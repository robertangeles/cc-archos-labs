import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, getKey } from "./booking-crypto";
import { CryptoError } from "./errors/booking";

// Contract: encrypt/decrypt are a sealed pair. The on-disk format
// (IV || tag || ciphertext, base64) is opaque to callers; only the
// round-trip property and tamper detection matter to the rest of the
// system. Tests use an explicit key so the env var is not required.

const TEST_KEY = randomBytes(32);

describe("booking-crypto", () => {
  it("round-trips plaintext", () => {
    const out = decrypt(encrypt("hello world", TEST_KEY), TEST_KEY);
    expect(out).toBe("hello world");
  });

  it("round-trips a realistic Google refresh token shape", () => {
    const token = "1//09abcXYZ-fake-refresh-token-with-1234567890_chars";
    const out = decrypt(encrypt(token, TEST_KEY), TEST_KEY);
    expect(out).toBe(token);
  });

  it("round-trips UTF-8 multi-byte characters", () => {
    const original = "ßéñ漢字😀";
    expect(decrypt(encrypt(original, TEST_KEY), TEST_KEY)).toBe(original);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encrypt("same plaintext", TEST_KEY);
    const b = encrypt("same plaintext", TEST_KEY);
    const c = encrypt("same plaintext", TEST_KEY);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it("ensures 1000 encrypts of the same plaintext yield 1000 distinct ciphertexts (IV uniqueness)", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(encrypt("x", TEST_KEY));
    }
    expect(set.size).toBe(1000);
  });

  it("throws CryptoError when the wrong key is used", () => {
    const wrongKey = randomBytes(32);
    const blob = encrypt("secret", TEST_KEY);
    expect(() => decrypt(blob, wrongKey)).toThrow(CryptoError);
  });

  it("throws CryptoError when ciphertext is tampered", () => {
    const blob = encrypt("secret", TEST_KEY);
    // Flip a single byte near the end (the ciphertext region).
    const bytes = Buffer.from(blob, "base64");
    bytes[bytes.length - 1]! ^= 0xff;
    const tampered = bytes.toString("base64");
    expect(() => decrypt(tampered, TEST_KEY)).toThrow(CryptoError);
  });

  it("throws CryptoError when the auth tag is tampered", () => {
    const blob = encrypt("secret", TEST_KEY);
    const bytes = Buffer.from(blob, "base64");
    // Tag lives at bytes 12..27. Flip a byte there.
    bytes[15]! ^= 0xff;
    expect(() => decrypt(bytes.toString("base64"), TEST_KEY)).toThrow(
      CryptoError,
    );
  });

  it("throws CryptoError on too-short input", () => {
    expect(() => decrypt("AAAAAA==", TEST_KEY)).toThrow(CryptoError);
  });

  it("throws CryptoError when BOOKING_ENCRYPTION_KEY env var is missing", () => {
    const saved = process.env.BOOKING_ENCRYPTION_KEY;
    delete process.env.BOOKING_ENCRYPTION_KEY;
    try {
      expect(() => getKey()).toThrow(CryptoError);
    } finally {
      if (saved !== undefined) process.env.BOOKING_ENCRYPTION_KEY = saved;
    }
  });

  it("throws CryptoError when BOOKING_ENCRYPTION_KEY is the wrong length", () => {
    const saved = process.env.BOOKING_ENCRYPTION_KEY;
    process.env.BOOKING_ENCRYPTION_KEY = Buffer.from(
      "too short",
      "utf8",
    ).toString("base64");
    try {
      expect(() => getKey()).toThrow(CryptoError);
    } finally {
      if (saved === undefined) {
        delete process.env.BOOKING_ENCRYPTION_KEY;
      } else {
        process.env.BOOKING_ENCRYPTION_KEY = saved;
      }
    }
  });
});
