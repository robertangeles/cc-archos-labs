import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbSelectMock,
  dbUpdateExecMock,
  hashPasswordMock,
  verifyPasswordResetTokenMock,
  revokeAllSessionsForUserMock,
  clearSessionCookieMock,
  logAuthEventMock,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  dbUpdateExecMock: vi.fn(),
  hashPasswordMock: vi.fn(),
  verifyPasswordResetTokenMock: vi.fn(),
  revokeAllSessionsForUserMock: vi.fn(),
  clearSessionCookieMock: vi.fn(),
  logAuthEventMock: vi.fn(),
}));

vi.mock("../../../../../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: dbSelectMock }) }),
    }),
    update: () => ({
      set: () => ({ where: dbUpdateExecMock }),
    }),
  }),
}));
vi.mock("../../../../../lib/db/schema", () => ({ users: {} }));
vi.mock("../../../../../lib/auth/password", () => ({
  hashPassword: hashPasswordMock,
}));
vi.mock("../../../../../lib/auth/password-reset-token", () => ({
  verifyPasswordResetToken: verifyPasswordResetTokenMock,
}));
vi.mock("../../../../../lib/auth/session", () => ({
  revokeAllSessionsForUser: revokeAllSessionsForUserMock,
}));
vi.mock("../../../../../lib/auth/cookies", () => ({
  clearSessionCookie: clearSessionCookieMock,
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

function makeRequest(body: unknown, opts: { origin?: string } = {}): Request {
  return new Request(
    "https://archoslabs.xyz/api/auth/password-reset/confirm",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: opts.origin ?? "https://archoslabs.xyz",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbSelectMock.mockResolvedValue([]);
  dbUpdateExecMock.mockResolvedValue(undefined);
  hashPasswordMock.mockResolvedValue("new-hash");
  verifyPasswordResetTokenMock.mockResolvedValue(null);
  revokeAllSessionsForUserMock.mockResolvedValue(1);
  clearSessionCookieMock.mockResolvedValue(undefined);
  logAuthEventMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/password-reset/confirm", () => {
  it("rejects cross-origin with 403", async () => {
    const r = await POST(
      makeRequest(
        { token: "t".repeat(40), newPassword: "p@ssw0rd-strong" },
        { origin: "https://attacker.example" },
      ),
    );
    expect(r.status).toBe(403);
  });

  it("returns 400 on malformed JSON", async () => {
    const r = await POST(makeRequest("{not-json"));
    expect(r.status).toBe(400);
  });

  it("returns 400 on invalid token (verifyPasswordResetToken returns null)", async () => {
    verifyPasswordResetTokenMock.mockResolvedValueOnce(null);
    const r = await POST(
      makeRequest({ token: "t".repeat(40), newPassword: "p@ssw0rd-strong" }),
    );
    expect(r.status).toBe(400);
    expect(dbUpdateExecMock).not.toHaveBeenCalled();
    expect(revokeAllSessionsForUserMock).not.toHaveBeenCalled();
  });

  it("returns 400 when token's tv claim mismatches users.token_version (replay)", async () => {
    verifyPasswordResetTokenMock.mockResolvedValueOnce({
      sub: "user-1",
      purpose: "password-reset",
      tv: 3, // stale
    });
    dbSelectMock.mockResolvedValueOnce([
      { id: "user-1", email: "u@x.com", isActive: true, tokenVersion: 4 },
    ]);
    const r = await POST(
      makeRequest({ token: "t".repeat(40), newPassword: "p@ssw0rd-strong" }),
    );
    expect(r.status).toBe(400);
    expect(dbUpdateExecMock).not.toHaveBeenCalled();
  });

  it("returns 400 when user is deactivated", async () => {
    verifyPasswordResetTokenMock.mockResolvedValueOnce({
      sub: "user-d",
      purpose: "password-reset",
      tv: 0,
    });
    dbSelectMock.mockResolvedValueOnce([
      { id: "user-d", email: "d@x.com", isActive: false, tokenVersion: 0 },
    ]);
    const r = await POST(
      makeRequest({ token: "t".repeat(40), newPassword: "p@ssw0rd-strong" }),
    );
    expect(r.status).toBe(400);
  });

  it("applies password reset + revokes all sessions + clears cookie + logs event", async () => {
    verifyPasswordResetTokenMock.mockResolvedValueOnce({
      sub: "user-2",
      purpose: "password-reset",
      tv: 0,
    });
    dbSelectMock.mockResolvedValueOnce([
      { id: "user-2", email: "u@x.com", isActive: true, tokenVersion: 0 },
    ]);
    const r = await POST(
      makeRequest({ token: "t".repeat(40), newPassword: "p@ssw0rd-strong" }),
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.ok).toBe(true);

    expect(hashPasswordMock).toHaveBeenCalledWith("p@ssw0rd-strong");
    expect(dbUpdateExecMock).toHaveBeenCalledTimes(1);
    expect(revokeAllSessionsForUserMock).toHaveBeenCalledWith("user-2");
    expect(clearSessionCookieMock).toHaveBeenCalledTimes(1);
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-2",
        eventType: "password_changed",
        metadata: { via: "reset_link" },
      }),
    );
  });
});
