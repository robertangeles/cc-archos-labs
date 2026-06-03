import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbSelectMock,
  dbUpdateExecMock,
  verifyVerificationTokenMock,
  logAuthEventMock,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  dbUpdateExecMock: vi.fn(),
  verifyVerificationTokenMock: vi.fn(),
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
vi.mock("../../../../lib/auth/verification-token", () => ({
  verifyVerificationToken: verifyVerificationTokenMock,
}));
vi.mock("../../../../lib/auth/audit", () => ({
  logAuthEvent: logAuthEventMock,
}));
vi.mock("../../../../lib/public-origin", () => ({
  getPublicOrigin: () => "https://archoslabs.xyz",
}));
vi.mock("../../../../lib/rate-limit", () => ({
  clientIpFromRequest: () => "203.0.113.1",
  rateLimit: () => ({ ok: true, remaining: 99, resetAt: 0 }),
}));

import { GET } from "./route";

function makeRequest(qs: string): Request {
  return new Request(`https://archoslabs.xyz/api/auth/verify-email${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbSelectMock.mockResolvedValue([]);
  dbUpdateExecMock.mockResolvedValue(undefined);
  verifyVerificationTokenMock.mockResolvedValue(null);
  logAuthEventMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/verify-email", () => {
  it("redirects to /login?error=missing_token when token is absent", async () => {
    const r = await GET(makeRequest(""));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=missing_token",
    );
  });

  it("redirects to /login?error=invalid_or_expired_token on bad token", async () => {
    verifyVerificationTokenMock.mockResolvedValueOnce(null);
    const r = await GET(makeRequest("?token=garbage"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=invalid_or_expired_token",
    );
    expect(dbUpdateExecMock).not.toHaveBeenCalled();
  });

  it("redirects to /login?error=invalid_or_expired_token when the user no longer exists", async () => {
    verifyVerificationTokenMock.mockResolvedValueOnce("ghost-user-id");
    dbSelectMock.mockResolvedValueOnce([]);
    const r = await GET(makeRequest("?token=valid-but-orphaned"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=invalid_or_expired_token",
    );
  });

  it("redirects to /login?error=account_deactivated for a deactivated user", async () => {
    verifyVerificationTokenMock.mockResolvedValueOnce("user-d");
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-d",
        email: "d@example.com",
        isActive: false,
        emailVerifiedAt: null,
      },
    ]);
    const r = await GET(makeRequest("?token=valid"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain(
      "/login?error=account_deactivated",
    );
  });

  it("verifies a newly-unverified user + writes audit + redirects to /account?verified=1", async () => {
    verifyVerificationTokenMock.mockResolvedValueOnce("user-new");
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-new",
        email: "n@example.com",
        isActive: true,
        emailVerifiedAt: null,
      },
    ]);
    const r = await GET(makeRequest("?token=valid"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("/account?verified=1");
    expect(dbUpdateExecMock).toHaveBeenCalledTimes(1);
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-new",
        eventType: "email_changed",
        metadata: expect.objectContaining({ kind: "initial_verification" }),
      }),
    );
  });

  it("is idempotent on already-verified user (no DB update, no audit)", async () => {
    verifyVerificationTokenMock.mockResolvedValueOnce("user-v");
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-v",
        email: "v@example.com",
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    ]);
    const r = await GET(makeRequest("?token=valid-twice"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("/account?verified=1");
    expect(dbUpdateExecMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });
});
