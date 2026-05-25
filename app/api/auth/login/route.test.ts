import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbSelectMock,
  dbUpdateExecMock,
  verifyPasswordMock,
  issueSessionMock,
  setSessionCookieMock,
  logAuthEventMock,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  dbUpdateExecMock: vi.fn(),
  verifyPasswordMock: vi.fn(),
  issueSessionMock: vi.fn(),
  setSessionCookieMock: vi.fn(),
  logAuthEventMock: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: dbSelectMock }),
      }),
    }),
    update: () => ({
      set: () => ({ where: dbUpdateExecMock }),
    }),
  }),
}));
vi.mock("../../../../lib/db/schema", () => ({ users: {} }));
vi.mock("../../../../lib/auth/password", () => ({
  verifyPassword: verifyPasswordMock,
  ENUMERATION_DUMMY_HASH: "$argon2id$v=19$m=19456,t=2,p=1$dummy",
}));
vi.mock("../../../../lib/auth/session", () => ({
  issueSession: issueSessionMock,
}));
vi.mock("../../../../lib/auth/cookies", () => ({
  setSessionCookie: setSessionCookieMock,
}));
vi.mock("../../../../lib/auth/audit", () => ({
  logAuthEvent: logAuthEventMock,
}));
vi.mock("../../../../lib/rate-limit", () => ({
  clientIpFromRequest: () => "203.0.113.1",
  rateLimit: () => ({ ok: true, remaining: 99, resetAt: 0 }),
}));
// Hermetic site URL so CSRF Origin check is deterministic in dev,
// where Vitest 4 auto-loads .env.local (NEXT_PUBLIC_SITE_URL=localhost:3007).
vi.mock("../../../../lib/site-config", () => ({
  getSiteUrl: () => "https://archoslabs.xyz",
}));

import { POST } from "./route";

function makeRequest(body: unknown, opts: { origin?: string } = {}): Request {
  return new Request("https://archoslabs.xyz/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: opts.origin ?? "https://archoslabs.xyz",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbSelectMock.mockResolvedValue([]);
  dbUpdateExecMock.mockResolvedValue(undefined);
  verifyPasswordMock.mockResolvedValue(false);
  issueSessionMock.mockResolvedValue({
    cookieValue: "test-jwt",
    sessionId: "sess-1",
    expiresAt: new Date(),
  });
  setSessionCookieMock.mockResolvedValue(undefined);
  logAuthEventMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/login", () => {
  it("rejects cross-origin with 403", async () => {
    const r = await POST(
      makeRequest(
        { email: "u@x.com", password: "anything" },
        { origin: "https://attacker.example" },
      ),
    );
    expect(r.status).toBe(403);
  });

  it("returns generic 401 for unknown email (and calls argon2 against dummy hash for timing parity)", async () => {
    // dbSelectMock resolves to [] by default → no user.
    const r = await POST(
      makeRequest({ email: "ghost@example.com", password: "anything-12345" }),
    );
    expect(r.status).toBe(401);
    const json = await r.json();
    expect(json).toEqual({ ok: false, error: "Invalid email or password." });
    // Critical: verify was called even though no user existed.
    expect(verifyPasswordMock).toHaveBeenCalledWith(
      "anything-12345",
      "$argon2id$v=19$m=19456,t=2,p=1$dummy",
    );
    expect(issueSessionMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        eventType: "login_failed",
        metadata: expect.objectContaining({ reason: "unknown_email" }),
      }),
    );
  });

  it("returns generic 401 for wrong password", async () => {
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-1",
        email: "u@example.com",
        passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$real",
        isActive: true,
        displayName: "User",
        role: "member",
      },
    ]);
    verifyPasswordMock.mockResolvedValueOnce(false);
    const r = await POST(
      makeRequest({ email: "u@example.com", password: "wrong" }),
    );
    expect(r.status).toBe(401);
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        eventType: "login_failed",
        metadata: expect.objectContaining({ reason: "wrong_password" }),
      }),
    );
    expect(issueSessionMock).not.toHaveBeenCalled();
  });

  it("returns 401 for deactivated user", async () => {
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-2",
        email: "u2@example.com",
        passwordHash: "real-hash",
        isActive: false,
        displayName: "Deactivated",
        role: "member",
      },
    ]);
    verifyPasswordMock.mockResolvedValueOnce(true);
    const r = await POST(
      makeRequest({ email: "u2@example.com", password: "correct" }),
    );
    expect(r.status).toBe(401);
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: "deactivated" }),
      }),
    );
  });

  it("issues session + sets cookie + logs login_password on success", async () => {
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-3",
        email: "u3@example.com",
        passwordHash: "real-hash",
        isActive: true,
        displayName: "Good User",
        role: "member",
      },
    ]);
    verifyPasswordMock.mockResolvedValueOnce(true);
    const r = await POST(
      makeRequest({ email: "u3@example.com", password: "correct" }),
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.ok).toBe(true);
    expect(json.user).toMatchObject({
      id: "user-3",
      email: "u3@example.com",
      role: "member",
    });
    expect(issueSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-3" }),
    );
    expect(setSessionCookieMock).toHaveBeenCalledWith("test-jwt");
    expect(dbUpdateExecMock).toHaveBeenCalled(); // last_login_at update
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-3",
        eventType: "login_password",
      }),
    );
  });
});
