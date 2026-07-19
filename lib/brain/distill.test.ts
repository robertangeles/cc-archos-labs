import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pure-logic + parsing tests for the distillation layer. The full
// extract → embed → judge → apply loop against real embeddings + DB is
// proven by tests/eval/brain-distillation.eval.test.ts (run via `pnpm eval`),
// same tier as the isolation canary.

// Mock the LLM boundary so extractFacts exercises the real callLlmJson +
// parse path without a network call or DB read (resolveLlmConfig reads the DB).
vi.mock("@/lib/llm/config", () => ({
  resolveLlmConfig: vi.fn(async () => ({ apiKey: "test-key", modelId: "m" })),
  buildAuthHeaders: () => ({ "Content-Type": "application/json" }),
  OPENROUTER_URL: "https://openrouter.test/chat/completions",
}));

import { parseFacts, parseDecisions, extractFacts } from "./distill";

const llmReply = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

describe("parseFacts", () => {
  it("returns the fact list from a valid object", () => {
    expect(parseFacts({ facts: ["The user is Rob", "Based in Melbourne"] })).toEqual([
      "The user is Rob",
      "Based in Melbourne",
    ]);
  });
  it("returns [] for {facts: []}", () => {
    expect(parseFacts({ facts: [] })).toEqual([]);
  });
  it("dedupes and trims, drops empties", () => {
    expect(parseFacts({ facts: ["  a ", "a", "", "b"] })).toEqual(["a", "b"]);
  });
  it("returns [] for anything malformed", () => {
    expect(parseFacts(null)).toEqual([]);
    expect(parseFacts({})).toEqual([]);
    expect(parseFacts({ facts: "not an array" })).toEqual([]);
    expect(parseFacts({ facts: [123] })).toEqual([]);
    expect(parseFacts("[]")).toEqual([]);
  });
});

describe("parseDecisions", () => {
  it("maps insert / skip / replace by candidate number", () => {
    const raw = {
      decisions: [
        { candidate: 1, action: "insert" },
        { candidate: 2, action: "replace", id: "abc" },
        { candidate: 3, action: "skip" },
      ],
    };
    expect(parseDecisions(raw, 3)).toEqual([
      { action: "insert" },
      { action: "replace", replaceId: "abc" },
      { action: "skip" },
    ]);
  });
  it("fails OPEN — malformed input becomes all-insert", () => {
    expect(parseDecisions(null, 2)).toEqual([{ action: "insert" }, { action: "insert" }]);
    expect(parseDecisions({ decisions: "x" }, 2)).toEqual([
      { action: "insert" },
      { action: "insert" },
    ]);
  });
  it("treats replace-without-id as insert (never a dangling supersede)", () => {
    expect(parseDecisions({ decisions: [{ candidate: 1, action: "replace" }] }, 1)).toEqual([
      { action: "insert" },
    ]);
  });
  it("defaults unmentioned candidates to insert and ignores out-of-range", () => {
    const raw = { decisions: [{ candidate: 2, action: "skip" }, { candidate: 9, action: "skip" }] };
    expect(parseDecisions(raw, 3)).toEqual([
      { action: "insert" },
      { action: "skip" },
      { action: "insert" },
    ]);
  });
});

describe("extractFacts (mocked LLM)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns extracted facts on a real statement", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      llmReply('{"facts": ["The user\'s name is Rob Angeles."]}'),
    );
    expect(await extractFacts("My name is Rob Angeles")).toEqual([
      "The user's name is Rob Angeles.",
    ]);
  });

  it("returns [] for a greeting (model emits {facts:[]})", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      llmReply('{"facts": []}'),
    );
    expect(await extractFacts("hi there")).toEqual([]);
  });

  it("strips code fences before parsing", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      llmReply('```json\n{"facts": ["The user likes DMBOK."]}\n```'),
    );
    expect(await extractFacts("I like DMBOK")).toEqual(["The user likes DMBOK."]);
  });

  it("returns [] when the LLM call fails (non-ok) — fails soft", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false });
    expect(await extractFacts("My name is Rob")).toEqual([]);
  });

  it("returns [] for a too-short message without calling the LLM", async () => {
    expect(await extractFacts("ok")).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
