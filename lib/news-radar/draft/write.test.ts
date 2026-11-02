import { describe, expect, it } from "vitest";
import { DEFAULT_DRAFT_CONFIG } from "./config";
import { LlmError, type ChatRequest, type ChatResult, type Llm } from "./llm";
import type { SkillPrompt } from "./skills";
import { runWriting } from "./write";

const chat = (text: string): ChatResult => ({ text, model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.02, citations: [], durationMs: 3 });
const TEMPLATE = "Topic: {{topic}}\nThesis: {{thesis}}\nResearch: {{raw_research}}\nSteelman: {{steelman_checkpoint}}\nAudience: {{target_audience}}\nIndustry: {{industry}}\nWords: {{word_count}}";
const skill = async (slug: string): Promise<SkillPrompt> => ({ slug, system: "S", template: TEMPLATE, temperature: null, maxTokens: 2000 });

const script = (replies: Record<string, ChatResult | Error>) => {
  const calls: ChatRequest[] = [];
  const llm: Llm = async (req) => {
    calls.push(req);
    const r = replies[req.label];
    if (!r) throw new Error(`unexpected call ${req.label}`);
    if (r instanceof Error) throw r;
    return r;
  };
  return { llm, calls };
};
const BASE = { topic: "Behind the AI Headline: Qwen", targetAudience: "Readers", research: "THE RESEARCH BRIEF" };

describe("runWriting", () => {
  it("runs thesis, steelman, essay in order and hands each result to the next", async () => {
    const { llm, calls } = script({ thesis: chat("THESIS-TEXT"), steelman: chat("STEELMAN-TEXT"), essay: chat("ESSAY-TEXT") });
    const r = await runWriting({ llm, skill }, DEFAULT_DRAFT_CONFIG, BASE);
    expect(r).toMatchObject({ ok: true, thesis: "THESIS-TEXT", steelman: "STEELMAN-TEXT", essay: "ESSAY-TEXT" });
    expect(calls.map((c) => c.label)).toEqual(["thesis", "steelman", "essay"]);
    expect(calls[0].user).not.toContain("THESIS-TEXT"); // thesis does not exist yet when it is written
    expect(calls[1].user).toContain("THESIS-TEXT");
    expect(calls[2].user).toContain("THESIS-TEXT");
    expect(calls[2].user).toContain("STEELMAN-TEXT");
    expect(calls[2].user).toContain("THE RESEARCH BRIEF");
  });

  it("fences everything that came from the web or from a model", async () => {
    const { llm, calls } = script({ thesis: chat("T"), steelman: chat("S"), essay: chat("E") });
    await runWriting({ llm, skill }, DEFAULT_DRAFT_CONFIG, BASE);
    const essay = calls[2];
    const marker = /<<<(UNTRUSTED_[0-9a-f-]+)\n/.exec(essay.user)![1];
    expect(essay.system).toContain(marker);
    for (const v of ["THE RESEARCH BRIEF", "Behind the AI Headline: Qwen"]) {
      expect(essay.user).toContain(`<<<${marker}\n${v}\n${marker}>>>`);
    }
    expect(essay.user).toContain("Words: 900"); // the target comes from the config, as plain text
  });

  it("uses the configured writer model with the default (large) token budget, not the skill row's small one", async () => {
    const { llm, calls } = script({ thesis: chat("T"), steelman: chat("S"), essay: chat("E") });
    await runWriting({ llm, skill }, { ...DEFAULT_DRAFT_CONFIG, models: { ...DEFAULT_DRAFT_CONFIG.models, writer: "x/writer" } }, BASE);
    expect(calls.every((c) => c.model === "x/writer")).toBe(true);
    expect(calls.every((c) => c.maxTokens === undefined)).toBe(true); // undefined -> the llm default of 16000
  });

  it("records a step per stage", async () => {
    const { llm } = script({ thesis: chat("T"), steelman: chat("S"), essay: chat("E") });
    const r = await runWriting({ llm, skill }, DEFAULT_DRAFT_CONFIG, BASE);
    expect(r.steps.map((s) => s.stepKey)).toEqual(["thesis", "steelman", "essay"]);
  });

  it("stops with model_error, keeping the steps already done", async () => {
    const { llm } = script({ thesis: chat("T"), steelman: new LlmError("steelman: model service returned 402", "client", 402) });
    const r = await runWriting({ llm, skill }, DEFAULT_DRAFT_CONFIG, BASE);
    expect(r).toMatchObject({ ok: false, reason: "model_error" });
    expect(r.steps.map((s) => s.stepKey)).toEqual(["thesis"]);
  });

  it("lets a broken skill surface as an error, not as a model failure", async () => {
    const { llm } = script({});
    const broken = async () => {
      throw new Error("skill missing");
    };
    await expect(runWriting({ llm, skill: broken }, DEFAULT_DRAFT_CONFIG, BASE)).rejects.toThrow("skill missing");
  });
});
