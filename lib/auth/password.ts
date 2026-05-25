import "server-only";
import { hash, verify, type Options } from "@node-rs/argon2";

// Argon2id password hashing for `users.password_hash`. Node-only —
// argon2 uses native bindings via @node-rs/argon2 which cannot load in
// the Edge runtime. proxy.ts must never import this file.
//
// Parameters chosen to give ~50ms verify time on commodity hardware
// (Render starter dyno) while staying inside OWASP Password Storage
// Cheat Sheet 2024 recommendations for argon2id:
//   memoryCost: 19456 KiB (~19 MiB) — OWASP min for argon2id
//   timeCost:   2 iterations         — OWASP min
//   parallelism: 1                   — single-thread, predictable timing
//   outputLen:  32 bytes             — argon2 default
//
// The encoded output ($argon2id$v=19$m=19456,t=2,p=1$...) carries the
// parameters inline so future re-tunes don't break existing hashes —
// `verifyPassword()` reads parameters from the stored string.

const ARGON2_OPTIONS: Options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

/**
 * Hash a password with argon2id. Returns the encoded string suitable
 * for storage in `users.password_hash`. ~50ms on commodity hardware.
 *
 * Rejects empty / whitespace-only input — caller must validate length
 * upstream (Zod), but defensive guard here too.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string" || plaintext.trim().length === 0) {
    throw new Error("hashPassword: plaintext must be a non-empty string");
  }
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verify a candidate password against a stored argon2id hash. Returns
 * true on match, false on mismatch OR on any decoding error (corrupt
 * hash, wrong algorithm prefix, etc.) — never throws.
 *
 * Constant-time compare is internal to argon2-verify. Callers that need
 * to avoid email-enumeration timing leaks should call `verifyPassword`
 * with a sentinel hash on the "user not found" branch so the response
 * time matches the "wrong password" branch. See lib/auth/session.ts.
 */
export async function verifyPassword(
  plaintext: string,
  storedHash: string,
): Promise<boolean> {
  if (typeof plaintext !== "string" || typeof storedHash !== "string") {
    return false;
  }
  if (plaintext.length === 0 || storedHash.length === 0) {
    return false;
  }
  try {
    return await verify(storedHash, plaintext);
  } catch {
    // Corrupt hash, wrong algorithm, unsupported version — treat as
    // mismatch. Real cause lands in observability via the caller.
    return false;
  }
}

/**
 * Sentinel hash used by `/api/auth/login` to normalise response time
 * when the email doesn't match any user. `verifyPassword(input, this)`
 * runs the full argon2id work and returns false — same wall-clock cost
 * as a real "wrong password" path, preventing timing-based email
 * enumeration.
 *
 * Generated once with `hashPassword("enumeration-defense-dummy")` at
 * ARGON2_OPTIONS above. The encoded string carries the parameters
 * inline; if ARGON2_OPTIONS changes, the hash continues to verify but
 * with the OLD parameters. The test suite asserts the parameter
 * preamble matches ARGON2_OPTIONS so a tuning change forces a hash
 * regenerate via CI.
 */
export const ENUMERATION_DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$+6xF35sgf1BvXli3z6WqIw$CDg9b4DQmSBAGo7xUK5Qbc91aNHnlgKactw015M9N3k";
