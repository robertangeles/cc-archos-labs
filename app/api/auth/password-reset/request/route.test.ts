import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbSelectMock,
  signPasswordResetTokenMock,
  logAuthEventMock,
  resendSendMock,
  getResendMock,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  signPasswordResetTokenMock: vi.fn(),
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
vi.mock("../../../../../lib/auth/password-reset-token", () => ({
  signPasswordResetToken: signPasswordResetTokenMock,
}));
vi.mock("../../../../../lib/auth/audit", () => ({
  logAuthEvent: logAuthEventMock,
}));
vi.mock("../../../../../lib/resend", () => ({
  getResend: getResendMock,
}));
vi.mock("../../../../../lib/email-templates", () => ({
  buildPasswordResetEmail: () => ({
    subject: "Reset",
    text: "reset",
    html: "<p>reset</p>",
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

function makeRequest(body: unknown, opts: { origin?: string } = {}): Request {
  return new Request(
    "https://archoslabs.xyz/api/auth/password-reset/request",
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
  signPasswordResetTokenMock.mockResolvedValue("test-reset-jwt");
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

describe("POST /api/auth/password-reset/request — enumeration defense", () => {
  it("rejects cross-origin with 403", async () => {
    const r = await POST(
      makeRequest({ email: "u@x.com" }, { origin: "https://attacker.example" }),
    );
    expect(r.status).toBe(403);
  });

  it("returns generic 200 for unknown email (no Resend call)", async () => {
    const r = await POST(makeRequest({ email: "ghost@example.com" }));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.ok).toBe(true);
    expect(json.message).toContain("If we have an account");
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        eventType: "password_reset_requested",
        metadata: expect.objectContaining({
          delivered: false,
          reason: "unknown_email",
        }),
      }),
    );
  });

  it("returns generic 200 for deactivated user (no send)", async () => {
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-d",
        email: "d@x.com",
        displayName: "Disabled",
        passwordHash: "h",
        isActive: false,
        tokenVersion: 0,
      },
    ]);
    const r = await POST(makeRequest({ email: "d@x.com" }));
    expect(r.status).toBe(200);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("returns generic 200 for OAuth-only user (no password to reset)", async () => {
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-o",
        email: "o@x.com",
        displayName: "OAuth-only",
        passwordHash: null,
        isActive: true,
        tokenVersion: 0,
      },
    ]);
    const r = await POST(makeRequest({ email: "o@x.com" }));
    expect(r.status).toBe(200);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("mints token + sends email + logs delivered=true on happy path", async () => {
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-1",
        email: "u@example.com",
        displayName: "Real User",
        passwordHash: "h",
        isActive: true,
        tokenVersion: 7,
      },
    ]);
    const r = await POST(makeRequest({ email: "u@example.com" }));
    expect(r.status).toBe(200);
    expect(signPasswordResetTokenMock).toHaveBeenCalledWith("user-1", 7);
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        eventType: "password_reset_requested",
        metadata: expect.objectContaining({ delivered: true }),
      }),
    );
  });

  it("still returns 200 + logs reason=send_failed when Resend errors", async () => {
    dbSelectMock.mockResolvedValueOnce([
      {
        id: "user-2",
        email: "u2@example.com",
        displayName: "Other",
        passwordHash: "h",
        isActive: true,
        tokenVersion: 0,
      },
    ]);
    resendSendMock.mockRejectedValueOnce(new Error("resend down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await POST(makeRequest({ email: "u2@example.com" }));
    expect(r.status).toBe(200);
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          delivered: false,
          reason: "send_failed",
        }),
      }),
    );
    expect(errSpy).toHaveBeenCalled();
  });

  it("returns generic 200 on malformed body (no leak)", async () => {
    const r = await POST(makeRequest("{not-json"));
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.ok).toBe(true);
  });
});
