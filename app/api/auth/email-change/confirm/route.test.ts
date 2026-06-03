import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbSelectMock,
  dbUpdateExecMock,
  verifyEmailChangeTokenMock,
  revokeAllSessionsForUserMock,
  clearSessionCookieMock,
  logAuthEventMock,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  dbUpdateExecMock: vi.fn(),
  verifyEmailChangeTokenMock: vi.fn(),
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
vi.mock("../../../../../lib/auth/email-change-token", () => ({
  verifyEmailChangeToken: verifyEmailChangeTokenMock,
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
vi.mock("../../../../../lib/public-origin", () => ({
  getPublicOrigin: () => "https://archoslabs.xyz",
}));
vi.mock("../../../../../lib/rate-limit", () => ({
  clientIpFromRequest: () => "203.0.113.1",
  rateLimit: () => ({ ok: true, remaining: 99, resetAt: 0 }),
}));

import { GET } from "./route";

function makeRequest(qs: string): Request {
  return new Request(
    `https://archoslabs.xyz/api/auth/email-change/confirm${qs}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbSelectMock.mockResolvedValue([]);
  dbUpdateExecMock.mockResolvedValue(undefined);
  verifyEmailChangeTokenMock.mockResolvedValue(null);
  revokeAllSessionsForUserMock.mockResolvedValue(1);
  clearSessionCookieMock.mockResolvedValue(undefined);
  logAuthEventMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/email-change/confirm", () => {
  it("redirects to /login?error=missing_token when token absent", async () => {
    const r = await GET(makeRequest(""));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("/login?error=missing_token");
  });

  it("redirects to invalid_or_expired_token on bad token", async () => {
    const r = await GET(makeRequest("?token=garbage"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=invalid_or_expired_token",
    );
  });

  it("redirects when token tv mismatches users.token_version (replay)", async () => {
    verifyEmailChangeTokenMock.mockResolvedValueOnce({
      sub: "user-1",
      purpose: "email-change",
      tv: 1,
      ne: "new@x.com",
    });
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-1",
        email: "old@x.com",
        isActive: true,
        tokenVersion: 2, // bumped since mint
      },
    ]);
    const r = await GET(makeRequest("?token=valid-but-stale"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=invalid_or_expired_token",
    );
    expect(dbUpdateExecMock).not.toHaveBeenCalled();
  });

  it("redirects with email_unavailable when the new email got claimed by someone else", async () => {
    verifyEmailChangeTokenMock.mockResolvedValueOnce({
      sub: "user-1",
      purpose: "email-change",
      tv: 0,
      ne: "new@x.com",
    });
    // First select: load the requesting user.
    // Second select: look up the new email — someone else has it.
    dbSelectMock
      .mockResolvedValueOnce([
        {
          id: "user-1",
          email: "old@x.com",
          isActive: true,
          tokenVersion: 0,
        },
      ])
      .mockResolvedValueOnce([{ id: "user-other" }]);
    const r = await GET(makeRequest("?token=valid"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("/login?error=email_unavailable");
    expect(dbUpdateExecMock).not.toHaveBeenCalled();
  });

  it("happy path: applies email change, revokes all sessions, clears cookie, logs event, redirects", async () => {
    verifyEmailChangeTokenMock.mockResolvedValueOnce({
      sub: "user-1",
      purpose: "email-change",
      tv: 0,
      ne: "new@example.com",
    });
    dbSelectMock
      .mockResolvedValueOnce([
        {
          id: "user-1",
          email: "old@example.com",
          isActive: true,
          tokenVersion: 0,
        },
      ])
      .mockResolvedValueOnce([]); // new email is free
    const r = await GET(makeRequest("?token=valid"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?email_changed=1",
    );
    expect(dbUpdateExecMock).toHaveBeenCalledTimes(1);
    expect(revokeAllSessionsForUserMock).toHaveBeenCalledWith("user-1");
    expect(clearSessionCookieMock).toHaveBeenCalledTimes(1);
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        eventType: "email_changed",
        metadata: expect.objectContaining({
          oldEmail: "old@example.com",
          newEmail: "new@example.com",
        }),
      }),
    );
  });
});
