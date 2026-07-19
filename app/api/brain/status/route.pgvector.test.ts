import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pgvector-backend path of GET /api/brain/status. The GBrain path is covered by
// route.test.ts. Here: "provisioned" = has ≥1 memory, service is always healthy
// (the app's own DB), lastActiveAt = newest memory.

const {
  getCurrentUserMock,
  rateLimitMock,
  memoryBackendMock,
  statusMock,
  getUserBrainMock,
  checkHealthMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  rateLimitMock: vi.fn(),
  memoryBackendMock: vi.fn(),
  statusMock: vi.fn(),
  getUserBrainMock: vi.fn(),
  checkHealthMock: vi.fn(),
}));

vi.mock("../../../../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("../../../../lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("../../../../lib/brain/memory", () => ({
  memoryBackend: memoryBackendMock,
  getMemoryStatusFromDb: statusMock,
}));
vi.mock("../../../../lib/brain/provision", () => ({
  getUserBrain: getUserBrainMock,
}));
vi.mock("../../../../lib/brain/client", () => ({ checkHealth: checkHealthMock }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue({ user: { id: "user-1" } });
  rateLimitMock.mockReturnValue({ ok: true, remaining: 199, resetAt: 0 });
  memoryBackendMock.mockReturnValue("pgvector");
  statusMock.mockResolvedValue({
    hasMemory: true,
    lastActiveAt: "2026-07-10T09:00:00.000Z",
  });
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/brain/status (pgvector)", () => {
  it("maps DB status to the provisioned/healthy contract, no GBrain calls", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({
      provisioned: true,
      serviceHealthy: true,
      lastActiveAt: "2026-07-10T09:00:00.000Z",
    });
    expect(getUserBrainMock).not.toHaveBeenCalled();
    expect(checkHealthMock).not.toHaveBeenCalled();
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
