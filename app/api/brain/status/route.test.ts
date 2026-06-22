import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserMock, rateLimitMock, getUserBrainMock, checkHealthMock } =
  vi.hoisted(() => ({
    getCurrentUserMock: vi.fn(),
    rateLimitMock: vi.fn(),
    getUserBrainMock: vi.fn(),
    checkHealthMock: vi.fn(),
  }));

vi.mock("../../../../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("../../../../lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
}));
vi.mock("../../../../lib/brain/provision", () => ({
  getUserBrain: getUserBrainMock,
}));
vi.mock("../../../../lib/brain/client", () => ({
  checkHealth: checkHealthMock,
}));

import { GET } from "./route";

const SESSION = { user: { id: "user-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(SESSION);
  rateLimitMock.mockReturnValue({ ok: true, remaining: 199, resetAt: 0 });
  getUserBrainMock.mockResolvedValue({ lastActiveAt: new Date("2026-06-22T08:05:00Z") });
  checkHealthMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/brain/status", () => {
  it("returns 401 when unauthenticated and does no work", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const r = await GET();
    expect(r.status).toBe(401);
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(getUserBrainMock).not.toHaveBeenCalled();
    expect(checkHealthMock).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and does no work", async () => {
    rateLimitMock.mockReturnValueOnce({ ok: false, remaining: 0, resetAt: 0 });
    const r = await GET();
    expect(r.status).toBe(429);
    expect(getUserBrainMock).not.toHaveBeenCalled();
    expect(checkHealthMock).not.toHaveBeenCalled();
  });

  it("rate-limits per user id", async () => {
    await GET();
    expect(rateLimitMock).toHaveBeenCalledWith("brain-status:user-1", 200);
  });

  it("returns provisioned + health status on the happy path", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({
      provisioned: true,
      serviceHealthy: true,
      lastActiveAt: "2026-06-22T08:05:00.000Z",
    });
  });
});
