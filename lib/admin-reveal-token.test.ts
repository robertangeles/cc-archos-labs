import { describe, expect, it, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  signRevealToken,
  verifyRevealToken,
  fingerprintSession,
} from "./admin-reveal-token";

// Contract: reveal token is a short-lived JWT that authorizes ONE admin
// session to read plaintext secrets for 5 minutes. The fingerprint claim
// pins the token to a specific session — a token issued for session A
// must not verify when presented alongside session B.

beforeEach(() => {
  // jose's HS256 needs >= 32 bytes; the production secret is 32 bytes
  // base64-encoded (43 chars) so we use a comparable length here.
  process.env.AUTH_SECRET = randomBytes(32).toString("base64");
});

describe("fingerprintSession", () => {
  it("produces a stable fingerprint for the same input", async () => {
    const a = await fingerprintSession("session-jwt-token-aaa");
    const b = await fingerprintSession("session-jwt-token-aaa");
    expect(a).toBe(b);
  });

  it("produces different fingerprints for different sessions", async () => {
    const a = await fingerprintSession("session-jwt-token-aaa");
    const b = await fingerprintSession("session-jwt-token-bbb");
    expect(a).not.toBe(b);
  });

  it("fingerprint is short enough to fit in a JWT claim", async () => {
    const fp = await fingerprintSession(randomBytes(256).toString("hex"));
    // 16 bytes base64url → 22 chars (no padding).
    expect(fp.length).toBeLessThanOrEqual(24);
  });
});

describe("signRevealToken / verifyRevealToken", () => {
  it("round-trips a token signed and verified with the same fingerprint", async () => {
    const fp = await fingerprintSession("admin-jwt-here");
    const token = await signRevealToken(fp);
    const payload = await verifyRevealToken(token, fp);
    expect(payload).not.toBeNull();
    expect(payload?.reveal).toBe(true);
    expect(payload?.sessionFingerprint).toBe(fp);
  });

  it("rejects a token verified with a different fingerprint (session swap)", async () => {
    const fpA = await fingerprintSession("admin-jwt-A");
    const fpB = await fingerprintSession("admin-jwt-B");
    const tokenForA = await signRevealToken(fpA);
    const payload = await verifyRevealToken(tokenForA, fpB);
    expect(payload).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const fp = await fingerprintSession("admin-jwt");
    const token = await signRevealToken(fp);
    // Flip a character in the middle to corrupt the signature.
    const tampered =
      token.slice(0, token.length / 2) +
      (token[Math.floor(token.length / 2)] === "A" ? "B" : "A") +
      token.slice(token.length / 2 + 1);
    const payload = await verifyRevealToken(tampered, fp);
    expect(payload).toBeNull();
  });

  it("rejects a token signed with a different AUTH_SECRET (key drift)", async () => {
    const fp = await fingerprintSession("admin-jwt");
    const token = await signRevealToken(fp);
    // Simulate AUTH_SECRET rotation between sign and verify.
    process.env.AUTH_SECRET = randomBytes(32).toString("base64");
    const payload = await verifyRevealToken(token, fp);
    expect(payload).toBeNull();
  });

  it("rejects an empty string token", async () => {
    const fp = await fingerprintSession("admin-jwt");
    const payload = await verifyRevealToken("", fp);
    expect(payload).toBeNull();
  });

  it("rejects a syntactically invalid token", async () => {
    const fp = await fingerprintSession("admin-jwt");
    const payload = await verifyRevealToken("not.a.jwt", fp);
    expect(payload).toBeNull();
  });
});
