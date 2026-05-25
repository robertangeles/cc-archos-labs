import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted; vi.fn() declarations are NOT.
// vi.hoisted() lifts the spy creation alongside vi.mock so the factory
// can reference them safely.
const {
  revokeSessionMock,
  clearCookieMock,
  getSessionJwtMock,
  logAuthEventMock,
} = vi.hoisted(() => ({
  revokeSessionMock: vi.fn(),
  clearCookieMock: vi.fn(),
  getSessionJwtMock: vi.fn(),
  logAuthEventMock: vi.fn(),
}));

vi.mock("../../../../lib/auth/session", () => ({
  revokeSession: revokeSessionMock,
}));
vi.mock("../../../../lib/auth/cookies", () => ({
  clearSessionCookie: clearCookieMock,
  getSessionJwtFromCookies: getSessionJwtMock,
}));
vi.mock("../../../../lib/auth/audit", () => ({
  logAuthEvent: logAuthEventMock,
}));
// Hermetic site URL so CSRF Origin check is deterministic in dev,
// where Vitest 4 auto-loads .env.local (NEXT_PUBLIC_SITE_URL=localhost:3007).
vi.mock("../../../../lib/site-config", () => ({
  getSiteUrl: () => "https://archoslabs.xyz",
}));

import { POST } from "./route";

beforeEach(() => {
  revokeSessionMock.mockReset();
  clearCookieMock.mockReset();
  getSessionJwtMock.mockReset();
  logAuthEventMock.mockReset();
  // Default: cookie missing.
  getSessionJwtMock.mockResolvedValue(null);
  clearCookieMock.mockResolvedValue(undefined);
  revokeSessionMock.mockResolvedValue(undefined);
  logAuthEventMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(opts: { origin?: string } = {}): Request {
  return new Request("https://archoslabs.xyz/api/auth/logout", {
    method: "POST",
    headers: {
      origin: opts.origin ?? "https://archoslabs.xyz",
    },
  });
}

describe("POST /api/auth/logout", () => {
  it("rejects cross-origin requests with 403", async () => {
    const r = await POST(makeRequest({ origin: "https://attacker.example" }));
    expect(r.status).toBe(403);
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(clearCookieMock).not.toHaveBeenCalled();
  });

  it("is idempotent when no session cookie is present", async () => {
    const r = await POST(makeRequest());
    expect(r.status).toBe(200);
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
    expect(clearCookieMock).toHaveBeenCalledTimes(1);
  });

  it("revokes the session + clears cookie + logs event on a valid cookie", async () => {
    getSessionJwtMock.mockResolvedValue({
      userId: "user-1",
      sessionId: "sess-1",
      tokenVersion: 0,
    });
    const r = await POST(makeRequest());
    expect(r.status).toBe(200);
    expect(revokeSessionMock).toHaveBeenCalledWith("sess-1");
    expect(clearCookieMock).toHaveBeenCalledTimes(1);
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        eventType: "logout",
      }),
    );
  });
});
