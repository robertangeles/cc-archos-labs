import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
  ENUMERATION_DUMMY_HASH,
} from "./password";

describe("hashPassword", () => {
  it("produces an argon2id-encoded string with the configured parameters", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("produces different hashes for the same input (random salt)", async () => {
    const a = await hashPassword("same-input");
    const b = await hashPassword("same-input");
    expect(a).not.toBe(b);
  });

  it("rejects empty input", async () => {
    await expect(hashPassword("")).rejects.toThrow(/non-empty/);
    await expect(hashPassword("   ")).rejects.toThrow(/non-empty/);
  });
});

describe("verifyPassword", () => {
  it("returns true on the correct password", async () => {
    const h = await hashPassword("p@ssw0rd-1");
    expect(await verifyPassword("p@ssw0rd-1", h)).toBe(true);
  });

  it("returns false on the wrong password", async () => {
    const h = await hashPassword("p@ssw0rd-1");
    expect(await verifyPassword("p@ssw0rd-2", h)).toBe(false);
  });

  it("returns false on empty input (no throw)", async () => {
    const h = await hashPassword("anything");
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("returns false on malformed hash (no throw)", async () => {
    expect(await verifyPassword("anything", "not-an-argon2-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });

  it("returns false on non-string args (defensive)", async () => {
    // @ts-expect-error — testing runtime defense
    expect(await verifyPassword(null, "x")).toBe(false);
    // @ts-expect-error — testing runtime defense
    expect(await verifyPassword("x", null)).toBe(false);
  });
});

describe("ENUMERATION_DUMMY_HASH", () => {
  it("is a valid argon2id-encoded string with the current ARGON2_OPTIONS", () => {
    // Asserting the prefix forces a CI failure if ARGON2_OPTIONS changes
    // but the constant is left stale — the test prompts a regenerate.
    expect(ENUMERATION_DUMMY_HASH).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
  });

  it("returns false when verifying against any input (it's a dummy)", async () => {
    expect(await verifyPassword("any input", ENUMERATION_DUMMY_HASH)).toBe(
      false,
    );
    expect(
      await verifyPassword("another input", ENUMERATION_DUMMY_HASH),
    ).toBe(false);
  });

  it("takes meaningful CPU time to verify (anti-enumeration)", async () => {
    // The whole point of the dummy is that verify runs the real argon2id
    // work and burns ~50ms. If parameters get accidentally weakened, this
    // catches it before production. 15ms lower-bound is a generous floor
    // accounting for fast hardware.
    const start = Date.now();
    await verifyPassword("any input", ENUMERATION_DUMMY_HASH);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThan(15);
  });
});
