import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookieStoreMock,
  exchangeCodeMock,
  fetchUserinfoMock,
  linkOrCreateMock,
  issueSessionMock,
  setSessionCookieMock,
  logAuthEventMock,
} = vi.hoisted(() => ({
  cookieStoreMock: {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
  exchangeCodeMock: vi.fn(),
  fetchUserinfoMock: vi.fn(),
  linkOrCreateMock: vi.fn(),
  issueSessionMock: vi.fn(),
  setSessionCookieMock: vi.fn(),
  logAuthEventMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(cookieStoreMock),
}));
vi.mock("../../../../../lib/auth/oauth-google", () => ({
  exchangeCodeForToken: exchangeCodeMock,
  fetchGoogleUserinfo: fetchUserinfoMock,
  getGoogleSigninConfig: () => ({
    clientId: "cid",
    clientSecret: "csecret",
    redirectUri: "https://archoslabs.xyz/api/auth/google/callback",
  }),
  GoogleSigninNotConfiguredError: class extends Error {},
  linkOrCreateUserFromGoogle: linkOrCreateMock,
  issueSessionForGoogleUser: issueSessionMock,
}));
vi.mock("../../../../../lib/auth/cookies", () => ({
  setSessionCookie: setSessionCookieMock,
}));
vi.mock("../../../../../lib/auth/audit", () => ({
  logAuthEvent: logAuthEventMock,
}));
vi.mock("../../../../../lib/public-origin", () => ({
  getPublicOrigin: () => "https://archoslabs.xyz",
}));
vi.mock("../../../../../lib/rate-limit", () => ({
  clientIpFromRequest: () => "203.0.113.1",
  rateLimit: () => ({ ok: true, remaining: 99, resetAt: 0 }),
}));
vi.mock("../start/route", () => ({
  STATE_COOKIE: "archos_google_oauth_state",
}));

import { GET } from "./route";

function makeRequest(qs: string): Request {
  return new Request(`https://archoslabs.xyz/api/auth/google/callback${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStoreMock.get.mockReturnValue({ value: "good-state-abc" });
  exchangeCodeMock.mockResolvedValue({
    access_token: "at",
    expires_in: 3600,
    scope: "openid email profile",
    token_type: "Bearer",
  });
  fetchUserinfoMock.mockResolvedValue({
    sub: "google-sub",
    email: "alice@example.com",
    email_verified: true,
    name: "Alice Example",
  });
  linkOrCreateMock.mockResolvedValue({
    userId: "user-1",
    newlyCreated: false,
    newlyLinked: false,
  });
  issueSessionMock.mockResolvedValue({
    cookieValue: "test-jwt",
    sessionId: "sess-1",
    expiresAt: new Date(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/google/callback", () => {
  it("redirects to /login?error=oauth_cancelled when Google returns error=", async () => {
    const r = await GET(
      makeRequest("?error=access_denied&state=good-state-abc"),
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=oauth_cancelled",
    );
    expect(exchangeCodeMock).not.toHaveBeenCalled();
    expect(cookieStoreMock.delete).toHaveBeenCalledWith(
      "archos_google_oauth_state",
    );
  });

  it("redirects to oauth_invalid when code is missing", async () => {
    const r = await GET(makeRequest("?state=good-state-abc"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("/login?error=oauth_invalid");
  });

  it("rejects state mismatch (CSRF defense)", async () => {
    cookieStoreMock.get.mockReturnValueOnce({ value: "different-cookie" });
    const r = await GET(makeRequest("?code=c&state=attacker-supplied"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=oauth_state_mismatch",
    );
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("rejects when state cookie is missing entirely", async () => {
    cookieStoreMock.get.mockReturnValueOnce(undefined);
    const r = await GET(makeRequest("?code=c&state=anything"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=oauth_state_mismatch",
    );
  });

  it("redirects when token exchange fails", async () => {
    exchangeCodeMock.mockResolvedValueOnce(null);
    const r = await GET(makeRequest("?code=bad&state=good-state-abc"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=oauth_token_exchange_failed",
    );
  });

  it("redirects when userinfo fetch fails", async () => {
    fetchUserinfoMock.mockResolvedValueOnce(null);
    const r = await GET(makeRequest("?code=c&state=good-state-abc"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=oauth_userinfo_failed",
    );
  });

  it("REJECTS Google response with email_verified=false (security-critical)", async () => {
    fetchUserinfoMock.mockResolvedValueOnce({
      sub: "google-sub",
      email: "unverified@example.com",
      email_verified: false,
      name: "Unverified",
    });
    const r = await GET(makeRequest("?code=c&state=good-state-abc"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=oauth_email_unverified",
    );
    expect(linkOrCreateMock).not.toHaveBeenCalled();
    expect(setSessionCookieMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "login_failed",
        metadata: expect.objectContaining({
          provider: "google",
          reason: "google_email_unverified",
        }),
      }),
    );
  });

  it("redirects when linkOrCreate throws (e.g. deactivated user)", async () => {
    linkOrCreateMock.mockRejectedValueOnce(new Error("user deactivated"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await GET(makeRequest("?code=c&state=good-state-abc"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=oauth_account_unavailable",
    );
    expect(setSessionCookieMock).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it("happy path: issues session, sets cookie, logs login_oauth, redirects", async () => {
    linkOrCreateMock.mockResolvedValueOnce({
      userId: "user-1",
      newlyCreated: false,
      newlyLinked: false,
    });
    const r = await GET(makeRequest("?code=c&state=good-state-abc"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("/account?signed_in=1");
    expect(issueSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(setSessionCookieMock).toHaveBeenCalledWith("test-jwt");
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        eventType: "login_oauth",
        metadata: expect.objectContaining({
          provider: "google",
          newlyCreated: false,
          newlyLinked: false,
        }),
      }),
    );
  });

  it("happy path: logs oauth_linked when newlyLinked=true (existing user just linked)", async () => {
    linkOrCreateMock.mockResolvedValueOnce({
      userId: "user-2",
      newlyCreated: false,
      newlyLinked: true,
    });
    await GET(makeRequest("?code=c&state=good-state-abc"));
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-2",
        eventType: "oauth_linked",
      }),
    );
  });
});
