import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieStoreMock } = vi.hoisted(() => {
  const set = vi.fn();
  return {
    cookieStoreMock: { set, get: vi.fn(), delete: vi.fn() } as const,
  };
});

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(cookieStoreMock),
}));
vi.mock("../../../../../lib/public-origin", () => ({
  getPublicOrigin: () => "https://archoslabs.xyz",
}));
vi.mock("../../../../../lib/rate-limit", () => ({
  clientIpFromRequest: () => "203.0.113.1",
  rateLimit: () => ({ ok: true, remaining: 99, resetAt: 0 }),
}));

import { GET } from "./route";

function makeRequest(): Request {
  return new Request("https://archoslabs.xyz/api/auth/google/start");
}

beforeEach(() => {
  cookieStoreMock.set.mockClear();
  vi.stubEnv("GOOGLE_SIGNIN_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_SIGNIN_CLIENT_SECRET", "test-client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/auth/google/start", () => {
  it("returns 404 when GOOGLE_SIGNIN_CLIENT_ID is not set (feature looks absent)", async () => {
    vi.stubEnv("GOOGLE_SIGNIN_CLIENT_ID", "");
    const r = await GET(makeRequest());
    expect(r.status).toBe(404);
  });

  it("returns 404 when GOOGLE_SIGNIN_CLIENT_SECRET is not set", async () => {
    vi.stubEnv("GOOGLE_SIGNIN_CLIENT_SECRET", "");
    const r = await GET(makeRequest());
    expect(r.status).toBe(404);
  });

  it("sets state cookie + redirects to Google with matching state param", async () => {
    const r = await GET(makeRequest());
    expect(r.status).toBe(303);
    const location = r.headers.get("location") ?? "";
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth?");

    // Cookie was set with the same value embedded in the URL.
    expect(cookieStoreMock.set).toHaveBeenCalledTimes(1);
    const [cookieName, cookieValue, opts] =
      cookieStoreMock.set.mock.calls[0];
    expect(cookieName).toBe("archos_google_oauth_state");
    expect(typeof cookieValue).toBe("string");
    expect((cookieValue as string).length).toBeGreaterThan(32);
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });

    // Same value embedded as `state=` in the redirect URL.
    const url = new URL(location);
    expect(url.searchParams.get("state")).toBe(cookieValue);
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://archoslabs.xyz/api/auth/google/callback",
    );
  });
});
