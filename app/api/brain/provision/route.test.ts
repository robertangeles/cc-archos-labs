import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUserMock,
  getIntegrationConfigMock,
  provisionBrainMock,
  getUserBrainMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  getIntegrationConfigMock: vi.fn(),
  provisionBrainMock: vi.fn(),
  getUserBrainMock: vi.fn(),
}));

vi.mock("../../../../lib/auth/current-user", () => ({
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("../../../../lib/integration-config", () => ({
  getIntegrationConfig: getIntegrationConfigMock,
}));
vi.mock("../../../../lib/brain/provision", () => ({
  provisionBrain: provisionBrainMock,
  getUserBrain: getUserBrainMock,
}));

import { POST } from "./route";

const SESSION = { user: { id: "user-1" } };
const CONFIGURED = { gbrainUrl: "https://gbrain.example.com", gbrainAdminToken: "admin" };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserMock.mockResolvedValue(SESSION);
  getIntegrationConfigMock.mockResolvedValue(CONFIGURED);
  provisionBrainMock.mockResolvedValue({ provisionedAt: new Date("2026-06-23T00:00:00Z") });
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/brain/provision", () => {
  it("returns 401 when unauthenticated", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const r = await POST();
    expect(r.status).toBe(401);
    expect(provisionBrainMock).not.toHaveBeenCalled();
  });

  it("returns 503 when GBrain is not configured", async () => {
    getIntegrationConfigMock.mockResolvedValueOnce({ gbrainUrl: null, gbrainAdminToken: null });
    const r = await POST();
    expect(r.status).toBe(503);
    expect(provisionBrainMock).not.toHaveBeenCalled();
  });

  it("returns a generic 500 without leaking the raw error", async () => {
    provisionBrainMock.mockRejectedValueOnce(
      new Error("GBrain client registration failed (500): https://gbrain.internal leaked-secret"),
    );
    const r = await POST();
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBe("Provisioning failed");
    // The raw infra detail must never reach the client.
    expect(JSON.stringify(body)).not.toMatch(/gbrain\.internal|leaked-secret|registration failed/i);
  });

  it("returns 200 + provisionedAt on the happy path", async () => {
    const r = await POST();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({
      provisioned: true,
      provisionedAt: "2026-06-23T00:00:00.000Z",
    });
  });
});
