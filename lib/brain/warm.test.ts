import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable mock state, reset per test (mirrors lib/chat/prompt-config.test.ts).
let config: { gbrainUrl: string | null; gbrainAdminToken: string | null };
let brain: unknown;
let token: string | null;
const callMcpMock = vi.fn();

vi.mock("@/lib/integration-config", () => ({
  getIntegrationConfig: async () => config,
}));
vi.mock("./provision", () => ({
  getUserBrain: async () => brain,
  getBrainToken: async () => token,
}));
vi.mock("./client", () => ({
  callMcp: (...args: unknown[]) => callMcpMock(...args),
}));

const { warmBrain } = await import("./warm");

beforeEach(() => {
  config = { gbrainUrl: "https://gbrain.example.com", gbrainAdminToken: "admin" };
  brain = { brainClientId: "gbrain_c", brainClientSecretEncrypted: "enc" };
  token = "tok_123";
  callMcpMock.mockReset();
  callMcpMock.mockResolvedValue({ result: {} });
});

afterEach(() => vi.clearAllMocks());

describe("warmBrain", () => {
  it("fires a throwaway query when configured, provisioned, and tokened", async () => {
    await warmBrain("user-1");
    expect(callMcpMock).toHaveBeenCalledTimes(1);
    const [tok, tool, args] = callMcpMock.mock.calls[0];
    expect(tok).toBe("tok_123");
    expect(tool).toBe("query");
    expect(args).toMatchObject({ limit: 1 });
  });

  it("no-ops when GBrain is not configured", async () => {
    config = { gbrainUrl: null, gbrainAdminToken: null };
    await warmBrain("user-1");
    expect(callMcpMock).not.toHaveBeenCalled();
  });

  it("no-ops when the user has no brain row", async () => {
    brain = null;
    await warmBrain("user-1");
    expect(callMcpMock).not.toHaveBeenCalled();
  });

  it("no-ops when no access token can be obtained", async () => {
    token = null;
    await warmBrain("user-1");
    expect(callMcpMock).not.toHaveBeenCalled();
  });

  it("never throws when the warm query fails", async () => {
    callMcpMock.mockRejectedValue(new Error("GBrain down"));
    await expect(warmBrain("user-1")).resolves.toBeUndefined();
  });
});
