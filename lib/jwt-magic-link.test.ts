import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  generateJti,
  MAGIC_LINK_MAX_AGE_SECONDS,
  signMagicLink,
  verifyMagicLink,
} from "./jwt-magic-link";
import { JWTExpiredError, JWTInvalidError } from "./errors/booking";

// Contract: sign + verify round-trips faithfully; expired tokens raise
// JWTExpiredError specifically (UI shows "link expired"); anything else
// bad raises JWTInvalidError. JTI revocation is route-level, not tested
// here.

const TEST_SECRET = "test-secret-of-sufficient-length-aaaa";

beforeEach(() => {
  process.env.AUTH_SECRET = TEST_SECRET;
});

afterEach(() => {
  delete process.env.AUTH_SECRET;
});

describe("generateJti", () => {
  it("returns url-safe base64 strings", () => {
    const jti = generateJti();
    expect(jti).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("yields unique values across many calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateJti());
    expect(set.size).toBe(1000);
  });
});

describe("signMagicLink + verifyMagicLink", () => {
  it("round-trips a cancel token", async () => {
    const jti = generateJti();
    const token = await signMagicLink("booking-abc", "cancel", jti);
    const payload = await verifyMagicLink(token);
    expect(payload.bid).toBe("booking-abc");
    expect(payload.kind).toBe("cancel");
    expect(payload.jti).toBe(jti);
  });

  it("round-trips a reschedule token", async () => {
    const jti = generateJti();
    const token = await signMagicLink("booking-xyz", "reschedule", jti);
    const payload = await verifyMagicLink(token);
    expect(payload.kind).toBe("reschedule");
  });

  it("includes iat and exp claims with reasonable values", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signMagicLink("b", "cancel", "j");
    const after = Math.floor(Date.now() / 1000);
    const payload = await verifyMagicLink(token);
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
    expect(payload.exp).toBeGreaterThanOrEqual(
      (payload.iat ?? 0) + MAGIC_LINK_MAX_AGE_SECONDS - 5,
    );
  });

  it("throws JWTInvalidError when the signature is wrong (different secret)", async () => {
    const token = await signMagicLink("b", "cancel", "j");
    process.env.AUTH_SECRET =
      "different-secret-of-sufficient-length-bbbb";
    await expect(verifyMagicLink(token)).rejects.toBeInstanceOf(
      JWTInvalidError,
    );
  });

  it("throws JWTInvalidError when the token is gibberish", async () => {
    await expect(verifyMagicLink("not.a.real.token")).rejects.toBeInstanceOf(
      JWTInvalidError,
    );
  });

  it("throws JWTExpiredError when the exp claim is in the past", async () => {
    // Craft a token with a past expiry using jose directly so we can
    // exercise the expiry branch without time travel.
    const secret = new TextEncoder().encode(TEST_SECRET);
    const expired = await new SignJWT({
      bid: "b",
      kind: "cancel",
      jti: "j",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(secret);
    await expect(verifyMagicLink(expired)).rejects.toBeInstanceOf(
      JWTExpiredError,
    );
  });

  it("throws JWTInvalidError when the payload is missing required fields", async () => {
    const secret = new TextEncoder().encode(TEST_SECRET);
    const wrongShape = await new SignJWT({ admin: true })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
    await expect(verifyMagicLink(wrongShape)).rejects.toBeInstanceOf(
      JWTInvalidError,
    );
  });

  it("throws JWTInvalidError when kind is not cancel or reschedule", async () => {
    const secret = new TextEncoder().encode(TEST_SECRET);
    const badKind = await new SignJWT({
      bid: "b",
      kind: "delete",
      jti: "j",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
    await expect(verifyMagicLink(badKind)).rejects.toBeInstanceOf(
      JWTInvalidError,
    );
  });

  it("throws JWTInvalidError if AUTH_SECRET is missing", async () => {
    delete process.env.AUTH_SECRET;
    await expect(
      signMagicLink("b", "cancel", "j"),
    ).rejects.toBeInstanceOf(JWTInvalidError);
  });
});
