import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import {
  SESSION_COOKIE,
  SESSION_JWT_TTL_SECONDS,
  signSessionJwt,
  verifySessionJwt,
} from "./session-jwt";

const TEST_SECRET =
  "test-secret-must-be-at-least-32-bytes-long-for-jose-hs256-ok";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", TEST_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SESSION_COOKIE + TTL constants", () => {
  it("uses the unified cookie name", () => {
    expect(SESSION_COOKIE).toBe("archos_session");
  });

  it("uses a 5-minute JWT TTL", () => {
    expect(SESSION_JWT_TTL_SECONDS).toBe(300);
  });
});

describe("signSessionJwt / verifySessionJwt round-trip", () => {
  it("verifies a freshly signed token and returns the payload shape", async () => {
    const token = await signSessionJwt({
      userId: "user-abc",
      sessionId: "sess-xyz",
      tokenVersion: 7,
    });
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(40);

    const decoded = await verifySessionJwt(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe("user-abc");
    expect(decoded?.sessionId).toBe("sess-xyz");
    expect(decoded?.tokenVersion).toBe(7);
    expect(typeof decoded?.iat).toBe("number");
    expect(typeof decoded?.exp).toBe("number");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await new SignJWT({
      userId: "u",
      sessionId: "s",
      tokenVersion: 0,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode("a-different-secret-32-bytes-min-pls"));

    expect(await verifySessionJwt(token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    // Mint with a deliberately past `exp` claim by leaning on jose directly.
    const expiredToken = await new SignJWT({
      userId: "u",
      sessionId: "s",
      tokenVersion: 0,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(TEST_SECRET));

    expect(await verifySessionJwt(expiredToken)).toBeNull();
  });

  it("rejects a token with malformed payload (missing userId)", async () => {
    const bad = await new SignJWT({ sessionId: "s", tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(TEST_SECRET));

    expect(await verifySessionJwt(bad)).toBeNull();
  });

  it("rejects a token with non-number tokenVersion", async () => {
    const bad = await new SignJWT({
      userId: "u",
      sessionId: "s",
      tokenVersion: "not-a-number",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(TEST_SECRET));

    expect(await verifySessionJwt(bad)).toBeNull();
  });

  it("returns null on empty/non-string input (defensive)", async () => {
    expect(await verifySessionJwt("")).toBeNull();
    // @ts-expect-error — testing runtime defense
    expect(await verifySessionJwt(null)).toBeNull();
    expect(await verifySessionJwt("not-even-a-jwt")).toBeNull();
  });
});

describe("AUTH_SECRET guard", () => {
  it("throws when AUTH_SECRET is missing", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH_SECRET", "");
    await expect(
      signSessionJwt({ userId: "u", sessionId: "s", tokenVersion: 0 }),
    ).rejects.toThrow(/AUTH_SECRET/);
  });

  it("throws when AUTH_SECRET is too short", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH_SECRET", "too-short");
    await expect(
      signSessionJwt({ userId: "u", sessionId: "s", tokenVersion: 0 }),
    ).rejects.toThrow(/AUTH_SECRET/);
  });
});
