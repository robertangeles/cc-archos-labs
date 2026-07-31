import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getOrgId: vi.fn(), resolveOrg: vi.fn() }));

vi.mock("../llm/config", () => ({
  OPENROUTER_URL: "https://openrouter.test/chat",
  buildAuthHeaders: (k: string) => ({ Authorization: `Bearer ${k}` }),
}));
vi.mock("../auth/org-context", () => ({
  getOrgIdFromCookies: m.getOrgId,
  resolveOrgContext: m.resolveOrg,
}));

import {
  isWorkspaceToolsEnabled,
  resolveToolOrgId,
  buildCallModel,
} from "./workspace-tools";

const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  m.getOrgId.mockReset().mockResolvedValue("cookie-org");
  m.resolveOrg
    .mockReset()
    .mockResolvedValue({ orgId: "validated-org", role: "owner" });
  delete process.env.WORKSPACE_TOOLS_ENABLED;
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  delete process.env.WORKSPACE_TOOLS_ENABLED;
  vi.unstubAllGlobals();
});

describe("isWorkspaceToolsEnabled", () => {
  it("reads WORKSPACE_TOOLS_ENABLED", () => {
    expect(isWorkspaceToolsEnabled()).toBe(false);
    process.env.WORKSPACE_TOOLS_ENABLED = "true";
    expect(isWorkspaceToolsEnabled()).toBe(true);
  });
});

describe("resolveToolOrgId", () => {
  it("returns the VALIDATED org (re-checked), never the raw cookie", async () => {
    expect(await resolveToolOrgId("u1")).toBe("validated-org");
    expect(m.resolveOrg).toHaveBeenCalledWith("u1", "cookie-org");
  });
  it("returns null when the user has no org", async () => {
    m.resolveOrg.mockResolvedValue(null);
    expect(await resolveToolOrgId("u1")).toBeNull();
  });
  it("returns null (fail-soft) when resolution throws", async () => {
    m.getOrgId.mockRejectedValue(new Error("no cookies"));
    expect(await resolveToolOrgId("u1")).toBeNull();
  });
});

describe("buildCallModel", () => {
  it("offers tools + parses content and tool_calls when offerTools=true", async () => {
    fetchMock().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "hi", tool_calls: [{ id: "t1" }] } }],
      }),
    });
    const msg = await buildCallModel("anthropic/claude", "KEY", "org-1")(
      [{ role: "user", content: "x" }],
      true,
    );
    expect(msg.content).toBe("hi");
    expect(msg.tool_calls).toEqual([{ id: "t1" }]);
    const body = JSON.parse(fetchMock().mock.calls[0][1].body);
    expect(body.stream).toBe(false);
    expect(body.tools).toBeDefined();
  });

  it("omits tools when offerTools=false", async () => {
    fetchMock().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "final" } }] }),
    });
    const msg = await buildCallModel("m", "KEY", "org-1")(
      [{ role: "user", content: "x" }],
      false,
    );
    expect(msg.content).toBe("final");
    const body = JSON.parse(fetchMock().mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
  });

  it("throws on a non-OK response (caller falls back to streaming)", async () => {
    fetchMock().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      buildCallModel("m", "KEY", "org-1")([{ role: "user", content: "x" }], true),
    ).rejects.toThrow("OpenRouter 500");
  });
});
