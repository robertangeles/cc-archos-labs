import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, rateLimitMock, warmBrainMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  warmBrainMock: vi.fn(),
}));

vi.mock("../../../../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("../../../../lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
}));
vi.mock("../../../../lib/brain/warm", () => ({
  warmBrain: warmBrainMock,
}));

import { POST } from "./route";

const SESSION = { user: { id: "user-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(SESSION);
  rateLimitMock.mockReturnValue({ ok: true, remaining: 99, resetAt: 0 });
  warmBrainMock.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/brain/warm", () => {
  it("returns 401 when unauthenticated and does not warm", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const r = await POST();
    expect(r.status).toBe(401);
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(warmBrainMock).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and does not warm", async () => {
    rateLimitMock.mockReturnValueOnce({ ok: false, remaining: 0, resetAt: 0 });
    const r = await POST();
    expect(r.status).toBe(429);
    expect(warmBrainMock).not.toHaveBeenCalled();
  });

  it("rate-limits per user id", async () => {
    await POST();
    expect(rateLimitMock).toHaveBeenCalledWith("brain-warm:user-1", 100);
  });

  it("warms the caller's own brain and returns 200 on the happy path", async () => {
    const r = await POST();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ warmed: true });
    expect(warmBrainMock).toHaveBeenCalledWith("user-1");
  });
});
