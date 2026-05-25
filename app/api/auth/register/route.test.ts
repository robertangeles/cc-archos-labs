import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbSelectMock,
  dbInsertMock,
  hashPasswordMock,
  issueSessionMock,
  signVerificationTokenMock,
  setSessionCookieMock,
  logAuthEventMock,
  resendSendMock,
  getResendMock,
  requireTurnstileMock,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  dbInsertMock: vi.fn(),
  hashPasswordMock: vi.fn(),
  issueSessionMock: vi.fn(),
  signVerificationTokenMock: vi.fn(),
  setSessionCookieMock: vi.fn(),
  logAuthEventMock: vi.fn(),
  resendSendMock: vi.fn(),
  getResendMock: vi.fn(),
  requireTurnstileMock: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: dbSelectMock,
        }),
      }),
    }),
    insert: () => ({
      values: () => ({ returning: dbInsertMock }),
    }),
  }),
}));
vi.mock("../../../../lib/db/schema", () => ({
  users: {},
}));
vi.mock("../../../../lib/auth/password", () => ({
  hashPassword: hashPasswordMock,
}));
vi.mock("../../../../lib/auth/session", () => ({
  issueSession: issueSessionMock,
}));
vi.mock("../../../../lib/auth/verification-token", () => ({
  signVerificationToken: signVerificationTokenMock,
}));
vi.mock("../../../../lib/auth/cookies", () => ({
  setSessionCookie: setSessionCookieMock,
}));
vi.mock("../../../../lib/auth/audit", () => ({
  logAuthEvent: logAuthEventMock,
}));
vi.mock("../../../../lib/auth/turnstile", () => ({
  requireTurnstile: requireTurnstileMock,
}));
vi.mock("../../../../lib/resend", () => ({
  getResend: getResendMock,
}));
vi.mock("../../../../lib/email-templates", () => ({
  buildVerificationEmail: () => ({
    subject: "Confirm your email",
    text: "verify",
    html: "<p>verify</p>",
  }),
}));
vi.mock("../../../../lib/public-origin", () => ({
  getPublicOrigin: () => "https://archoslabs.xyz",
}));
// Hermetic site URL so CSRF Origin check is deterministic. Without this,
// Vitest 4 auto-loads .env.local which sets NEXT_PUBLIC_SITE_URL to
// localhost:3007 in dev, causing every same-origin test to fail.
vi.mock("../../../../lib/site-config", () => ({
  getSiteUrl: () => "https://archoslabs.xyz",
}));
vi.mock("../../../../lib/rate-limit", () => ({
  clientIpFromRequest: () => "203.0.113.1",
  rateLimit: () => ({ ok: true, remaining: 99, resetAt: 0 }),
}));

import { POST } from "./route";

const VALID_BODY = {
  email: "new.user@example.com",
  password: "p@ssw0rd-strong",
  firstName: "New",
  lastName: "User",
};

function makeRequest(body: unknown, opts: { origin?: string } = {}): Request {
  return new Request("https://archoslabs.xyz/api/auth/register", {
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
  dbSelectMock.mockResolvedValue([]); // no existing user by default
  dbInsertMock.mockResolvedValue([{ id: "user-new-1" }]);
  hashPasswordMock.mockResolvedValue("$argon2id$v=19$m=19456,t=2,p=1$dummy");
  issueSessionMock.mockResolvedValue({
    cookieValue: "test-jwt-cookie-value",
    sessionId: "sess-new-1",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  signVerificationTokenMock.mockResolvedValue("test-verify-jwt");
  setSessionCookieMock.mockResolvedValue(undefined);
  logAuthEventMock.mockResolvedValue(undefined);
  resendSendMock.mockResolvedValue({ data: { id: "resend-1" }, error: null });
  getResendMock.mockResolvedValue({
    resend: { emails: { send: resendSendMock } },
    from: "Archos Labs <no-reply@archoslabs.xyz>",
  });
  // Default: Turnstile bypassed (feature OFF). Per-test overrides
  // simulate the active-on path.
  requireTurnstileMock.mockResolvedValue({
    ok: true,
    errorCodes: [],
    bypassed: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/register", () => {
  it("rejects cross-origin requests with 403", async () => {
    const r = await POST(makeRequest(VALID_BODY, { origin: "https://attacker.example" }));
    expect(r.status).toBe(403);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("returns 400 on malformed JSON", async () => {
    const r = await POST(makeRequest("{not-json"));
    expect(r.status).toBe(400);
  });

  it("returns 400 when validation fails (short password)", async () => {
    const r = await POST(makeRequest({ ...VALID_BODY, password: "short" }));
    expect(r.status).toBe(400);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("returns 409 when email already exists", async () => {
    dbSelectMock.mockResolvedValueOnce([{ id: "existing-user-1" }]);
    const r = await POST(makeRequest(VALID_BODY));
    expect(r.status).toBe(409);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("creates account + issues session + sends verification email + logs register event", async () => {
    const r = await POST(makeRequest(VALID_BODY));
    expect(r.status).toBe(201);
    const json = await r.json();
    expect(json.ok).toBe(true);
    expect(json.user).toMatchObject({
      id: "user-new-1",
      email: "new.user@example.com",
    });

    expect(hashPasswordMock).toHaveBeenCalledWith("p@ssw0rd-strong");
    expect(dbInsertMock).toHaveBeenCalledTimes(1);
    expect(issueSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-new-1" }),
    );
    expect(setSessionCookieMock).toHaveBeenCalledWith("test-jwt-cookie-value");
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-new-1", eventType: "register" }),
    );
    expect(resendSendMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when Turnstile is active and verify fails", async () => {
    requireTurnstileMock.mockResolvedValueOnce({
      ok: false,
      errorCodes: ["invalid-input-response"],
      bypassed: false,
    });
    const r = await POST(makeRequest(VALID_BODY));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.error).toContain("Bot check");
    // Critical: we don't even reach the DB on a failed Turnstile check.
    expect(dbInsertMock).not.toHaveBeenCalled();
    expect(hashPasswordMock).not.toHaveBeenCalled();
  });

  it("still returns 201 even if the verification email send fails", async () => {
    resendSendMock.mockRejectedValueOnce(new Error("resend down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await POST(makeRequest(VALID_BODY));
    expect(r.status).toBe(201);
    expect(setSessionCookieMock).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});
