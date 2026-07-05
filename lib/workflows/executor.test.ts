import { describe, it, expect, vi, beforeEach } from "vitest";
import type { workflowStep } from "../db/schema";

// executeStep on a RAW-prompt step (no skillId, no input mappings) makes no DB
// call: resolveStepInputs skips its skill-input lookup and loadSkillConfig is
// never reached. So we only need to mock the LLM boundary. getDb is stubbed
// defensively — if the raw path ever calls it, this throws and the test fails.
vi.mock("../db", () => ({
  getDb: () => {
    throw new Error("getDb must not be called for a raw-prompt step");
  },
}));

const executeSkillMock = vi.fn();
vi.mock("../skills/execute", () => ({
  executeSkill: (opts: unknown) => executeSkillMock(opts),
}));

const resolveLlmConfigMock = vi.fn();
vi.mock("../llm/config", () => ({
  resolveLlmConfig: () => resolveLlmConfigMock(),
}));

import { executeStep } from "./executor";

type Step = typeof workflowStep.$inferSelect;

function rawStep(over: Partial<Step> = {}): Step {
  return {
    stepId: "s1",
    workflowId: "w1",
    skillId: null,
    prompt: "Write about {topic}",
    model: "openai/gpt-4o",
    provider: "openrouter",
    overrides: {},
    inputMappings: {},
    sortOrder: 0,
    ...over,
  } as unknown as Step;
}

describe("executeStep", () => {
  beforeEach(() => {
    executeSkillMock.mockReset();
    resolveLlmConfigMock.mockReset();
    resolveLlmConfigMock.mockResolvedValue({ modelId: "default-model", apiKey: "k" });
  });

  it("returns a success StepResult and a context patch under both key forms", async () => {
    executeSkillMock.mockResolvedValue({
      result: "a haiku",
      model: "openai/gpt-4o",
      usage: { inputTokens: 12, outputTokens: 8 },
    });

    const { result, contextPatch } = await executeStep(rawStep(), { topic: "spring" }, "");

    expect(result.status).toBe("success");
    expect(result.stepId).toBe("s1");
    expect(result.skillId).toBe("raw");
    expect(result.outputs).toEqual({ result: "a haiku" });
    expect(result.model).toBe("openai/gpt-4o");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
    expect(result.error).toBeUndefined();
    // outputKey defaults to "result" for a raw step, so both key forms collapse
    // to the same key — the persisted snapshot always carries step_<id>.result.
    expect(contextPatch).toEqual({ "step_s1.result": "a haiku" });
  });

  it("falls back to the configured default model when the step has no model", async () => {
    executeSkillMock.mockResolvedValue({
      result: "x",
      model: "default-model",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await executeStep(rawStep({ model: "" }), {}, "");

    expect(executeSkillMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "default-model" }),
    );
  });

  it("appends the rules block to the system prompt when present, omits it when empty", async () => {
    executeSkillMock.mockResolvedValue({
      result: "x",
      model: "openai/gpt-4o",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await executeStep(rawStep(), {}, "SAFETY RULES");
    expect(executeSkillMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ systemPrompt: "SAFETY RULES" }),
    );

    await executeStep(rawStep(), {}, "");
    expect(executeSkillMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ systemPrompt: undefined }),
    );
  });

  it("never throws on failure: returns an error StepResult, empty outputs, no context patch", async () => {
    executeSkillMock.mockRejectedValue(new Error("Model is busy"));

    const { result, contextPatch } = await executeStep(rawStep(), {}, "");

    expect(result.status).toBe("error");
    expect(result.outputs).toEqual({});
    expect(result.error).toBe("Model is busy");
    // On error the model falls back to the step's own model, never the response.
    expect(result.model).toBe("openai/gpt-4o");
    // Critical for the Regenerate feature: a failed step adds NO context keys,
    // so it can never overwrite a prior good output downstream.
    expect(contextPatch).toEqual({});
  });
});
