import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/brain/status: "provisioned" = has ≥1 memory, service is always
// healthy (the app's own DB), lastActiveAt = newest memory.

const { getCurrentUserMock, rateLimitMock, statusMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("../../../../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("../../../../lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("../../../../lib/brain/memory", () => ({
  getMemoryStatusFromDb: statusMock,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue({ user: { id: "user-1" } });
  rateLimitMock.mockReturnValue({ ok: true, remaining: 199, resetAt: 0 });
  statusMock.mockResolvedValue({
    hasMemory: true,
    lastActiveAt: "2026-07-10T09:00:00.000Z",
  });
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/brain/status", () => {
  it("maps DB status to the provisioned/healthy contract", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({
      provisioned: true,
      serviceHealthy: true,
      lastActiveAt: "2026-07-10T09:00:00.000Z",
    });
  });

  it("reports not-provisioned for a user with no memories yet", async () => {
    statusMock.mockResolvedValueOnce({ hasMemory: false, lastActiveAt: null });
    const r = await GET();
    await expect(r.json()).resolves.toEqual({
      provisioned: false,
      serviceHealthy: true,
      lastActiveAt: null,
    });
  });
});
