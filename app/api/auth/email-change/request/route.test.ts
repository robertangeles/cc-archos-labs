import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbSelectMock,
  getCurrentUserMock,
  signEmailChangeTokenMock,
  logAuthEventMock,
  resendSendMock,
  getResendMock,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  signEmailChangeTokenMock: vi.fn(),
  logAuthEventMock: vi.fn(),
  resendSendMock: vi.fn(),
  getResendMock: vi.fn(),
}));

vi.mock("../../../../../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: dbSelectMock }) }),
    }),
  }),
}));
vi.mock("../../../../../lib/db/schema", () => ({ users: {} }));
vi.mock("../../../../../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("../../../../../lib/auth/email-change-token", () => ({
  signEmailChangeToken: signEmailChangeTokenMock,
}));
vi.mock("../../../../../lib/auth/audit", () => ({
  logAuthEvent: logAuthEventMock,
}));
vi.mock("../../../../../lib/resend", () => ({
  getResend: getResendMock,
}));
vi.mock("../../../../../lib/email-templates", () => ({
  buildEmailChangeConfirmEmail: () => ({
    subject: "Confirm new email",
    text: "confirm",
    html: "<p>confirm</p>",
  }),
}));
vi.mock("../../../../../lib/public-origin", () => ({
  getPublicOrigin: () => "https://archoslabs.xyz",
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
    email: "old@example.com",
    role: "member",
    isActive: true,
    tokenVersion: 5,
    displayName: "Real User",
    emailVerifiedAt: new Date(),
  },
  session: {
    id: "sess-1",
    expiresAt: new Date(Date.now() + 1e9),
    lastSeenAt: new Date(),
    revokedAt: null,
  },
};

function makeRequest(body: unknown, opts: { origin?: string } = {}): Request {
  return new Request("https://archoslabs.xyz/api/auth/email-change/request", {
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
  getCurrentUserMock.mockResolvedValue(SESSION);
  signEmailChangeTokenMock.mockResolvedValue("test-change-jwt");
  logAuthEventMock.mockResolvedValue(undefined);
  resendSendMock.mockResolvedValue({ data: { id: "r-1" }, error: null });
  getResendMock.mockResolvedValue({
    resend: { emails: { send: resendSendMock } },
    from: "Archos Labs <no-reply@archoslabs.xyz>",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/email-change/request", () => {
  it("rejects cross-origin with 403", async () => {
    const r = await POST(
      makeRequest(
        { newEmail: "new@example.com" },
        { origin: "https://attacker.example" },
      ),
    );
    expect(r.status).toBe(403);
  });

  it("returns 401 when not authenticated", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const r = await POST(makeRequest({ newEmail: "new@example.com" }));
    expect(r.status).toBe(401);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("no-ops with generic 200 when newEmail equals current email", async () => {
    const r = await POST(makeRequest({ newEmail: "OLD@example.com" }));
    expect(r.status).toBe(200);
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(signEmailChangeTokenMock).not.toHaveBeenCalled();
  });

  it("returns generic 200 without sending when newEmail belongs to someone else", async () => {
    dbSelectMock.mockResolvedValueOnce([{ id: "user-other" }]);
    const r = await POST(makeRequest({ newEmail: "taken@example.com" }));
    expect(r.status).toBe(200);
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        eventType: "email_change_requested",
        metadata: expect.objectContaining({
          delivered: false,
          reason: "new_email_in_use",
        }),
      }),
    );
  });

  it("mints token + sends to NEW email + logs delivered=true on happy path", async () => {
    dbSelectMock.mockResolvedValueOnce([]); // new email is free
    const r = await POST(makeRequest({ newEmail: "fresh@example.com" }));
    expect(r.status).toBe(200);
    expect(signEmailChangeTokenMock).toHaveBeenCalledWith(
      "user-1",
      5,
      "fresh@example.com",
    );
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    // CRITICAL: send target is the NEW email, not the current one.
    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "fresh@example.com" }),
    );
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        eventType: "email_change_requested",
        metadata: expect.objectContaining({ delivered: true }),
      }),
    );
  });
});
