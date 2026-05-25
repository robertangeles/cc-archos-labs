import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbSelectMock,
  dbDeleteMock,
  getCurrentUserMock,
  logAuthEventMock,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  dbDeleteMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  logAuthEventMock: vi.fn(),
}));

vi.mock("../../../../../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: dbSelectMock }) }),
    }),
    delete: () => ({
      where: () => ({ returning: dbDeleteMock }),
    }),
  }),
}));
vi.mock("../../../../../lib/db/schema", () => ({
  oauthAccount: {},
  users: {},
}));
vi.mock("../../../../../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("../../../../../lib/auth/audit", () => ({
  logAuthEvent: logAuthEventMock,
}));
vi.mock("../../../../../lib/rate-limit", () => ({
  clientIpFromRequest: () => "203.0.113.1",
  rateLimit: () => ({ ok: true, remaining: 99, resetAt: 0 }),
}));
// Hermetic site URL so CSRF Origin check is deterministic in dev,
// where Vitest 4 auto-loads .env.local (NEXT_PUBLIC_SITE_URL=localhost:3007).
vi.mock("../../../../../lib/site-config", () => ({
  getSiteUrl: () => "https://archoslabs.xyz",
}));

import { POST } from "./route";

const SESSION = {
  user: {
    id: "user-1",
    email: "u@example.com",
    role: "member",
    isActive: true,
    tokenVersion: 0,
    displayName: "User",
    emailVerifiedAt: new Date(),
  },
  session: {
    id: "sess-1",
    expiresAt: new Date(),
    lastSeenAt: new Date(),
    revokedAt: null,
  },
};

function makeRequest(opts: { origin?: string } = {}): Request {
  return new Request("https://archoslabs.xyz/api/auth/google/unlink", {
    method: "POST",
    headers: {
      origin: opts.origin ?? "https://archoslabs.xyz",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(SESSION);
  dbSelectMock.mockResolvedValue([{ passwordHash: "real-hash" }]);
  dbDeleteMock.mockResolvedValue([{ id: "oauth-1" }]);
  logAuthEventMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/google/unlink", () => {
  it("rejects cross-origin with 403", async () => {
    const r = await POST(makeRequest({ origin: "https://attacker.example" }));
    expect(r.status).toBe(403);
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const r = await POST(makeRequest());
    expect(r.status).toBe(401);
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });

  it("REFUSES unlink when user has no password (lockout defense)", async () => {
    dbSelectMock.mockResolvedValueOnce([{ passwordHash: null }]);
    const r = await POST(makeRequest());
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.error).toContain("Set a password");
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes oauth_account + logs event on happy path", async () => {
    const r = await POST(makeRequest());
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json).toEqual({ ok: true, unlinked: true });
    expect(dbDeleteMock).toHaveBeenCalled();
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        eventType: "oauth_unlinked",
        metadata: { provider: "google" },
      }),
    );
  });

  it("returns ok:true, unlinked:false (idempotent) when no link existed; no audit", async () => {
    dbDeleteMock.mockResolvedValueOnce([]);
    const r = await POST(makeRequest());
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json).toEqual({ ok: true, unlinked: false });
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });
});
