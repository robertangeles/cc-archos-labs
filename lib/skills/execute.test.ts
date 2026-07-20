import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  recallMemories: vi.fn(),
  formatRecallContext: vi.fn(),
  getIntegrationConfig: vi.fn(),
}));

vi.mock("../integration-config", () => ({
  getIntegrationConfig: m.getIntegrationConfig,
}));
vi.mock("../llm/config", () => ({
  OPENROUTER_URL: "https://openrouter.test/chat",
  buildAuthHeaders: (k: string) => ({ Authorization: `Bearer ${k}` }),
}));
vi.mock("../brain/recall", () => ({
  recallMemories: m.recallMemories,
  formatRecallContext: m.formatRecallContext,
}));

import { executeSkill } from "./execute";

const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;
const sentMessages = () =>
  JSON.parse(fetchMock().mock.calls[0][1].body).messages as Array<{
    role: string;
    content: string;
  }>;

const base = {
  promptTemplate: "Do {{thing}}",
  inputs: { thing: "X" },
  model: "m",
};

beforeEach(() => {
  m.getIntegrationConfig.mockReset().mockResolvedValue({ llmApiKey: "KEY" });
  m.recallMemories
    .mockReset()
    .mockResolvedValue({ memories: ["Acme is active"], source: "brain", count: 1 });
  m.formatRecallContext
    .mockReset()
    .mockReturnValue("## Brain Memory\n- Acme is active\n---\n\n");
  delete process.env.WORKSPACE_SKILL_RECALL;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "result" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    }),
  );
});

afterEach(() => {
  delete process.env.WORKSPACE_SKILL_RECALL;
  vi.unstubAllGlobals();
});

describe("executeSkill — E3 workspace/brain recall injection", () => {
  it("does not recall when the flag is off (skill output unchanged)", async () => {
    await executeSkill({ ...base, systemPrompt: "SYS", userId: "u1" });
    expect(m.recallMemories).not.toHaveBeenCalled();
    expect(sentMessages()[0]).toEqual({ role: "system", content: "SYS" });
  });

  it("does not recall without a userId, even with the flag on", async () => {
    process.env.WORKSPACE_SKILL_RECALL = "true";
    await executeSkill({ ...base, systemPrompt: "SYS" });
    expect(m.recallMemories).not.toHaveBeenCalled();
  });

  it("injects recall using the ASSEMBLED prompt as the query", async () => {
    process.env.WORKSPACE_SKILL_RECALL = "true";
    await executeSkill({ ...base, systemPrompt: "SYS", userId: "u1" });
    // template placeholders resolved before being used as the recall query
    expect(m.recallMemories).toHaveBeenCalledWith("u1", "Do X");
    const sys = sentMessages()[0].content;
    expect(sys).toContain("Brain Memory");
    expect(sys).toContain("SYS"); // original system prompt preserved
  });

  it("works when the skill has no systemPrompt", async () => {
    process.env.WORKSPACE_SKILL_RECALL = "true";
    await executeSkill({ ...base, userId: "u1" });
    expect(sentMessages()[0].content).toContain("Brain Memory");
  });

  it("is fail-soft — a recall failure still runs the skill ungrounded", async () => {
    process.env.WORKSPACE_SKILL_RECALL = "true";
    m.recallMemories.mockRejectedValue(new Error("recall down"));
    await expect(
      executeSkill({ ...base, systemPrompt: "SYS", userId: "u1" }),
    ).resolves.toBeDefined();
    expect(sentMessages()[0]).toEqual({ role: "system", content: "SYS" });
  });
});
