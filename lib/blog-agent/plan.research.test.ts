import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOG_AGENT_CONFIG_STARTER } from "./config-shared";

// `sonar-deep-research` returns its headers in ~10s and then streams the body
// for minutes. The abort bound must therefore cover time-to-headers only. A
// signal left armed across the body read kills a research call that already
// succeeded, and the failure is invisible: researchLandscape swallows it and
// generateBatch reports "research returned nothing", which reads like the
// provider misbehaving rather than our own timer firing.
//
// Measured against PROD on 2026-07-26: HTTP 200 at 10s, body still streaming
// at 180s.

const generateStructured = vi.fn();

vi.mock("../db", () => ({ getDb: () => ({}) }));
vi.mock("../claude", () => ({
  generateStructured: (...a: unknown[]) => generateStructured(...a),
}));
vi.mock("./config", () => ({
  getPlanPrompt: async () => ({ systemPrompt: "plan" }),
}));
vi.mock("../llm/config", () => ({
  OPENROUTER_URL: "https://openrouter.test/v1/chat/completions",
  buildAuthHeaders: () => ({}),
  resolveLlmConfig: async () => ({ apiKey: "sk-test" }),
}));

const { generateBatch } = await import("./plan");

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("researchLandscape body timeout", () => {
  it("keeps a response whose body arrives after the abort deadline", async () => {
    // The body is held back until the test releases it, so the deadline is
    // guaranteed to pass first.
    let releaseBody!: () => void;
    const bodyArrived = new Promise<void>((r) => {
      releaseBody = r;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { signal: AbortSignal }) => ({
        ok: true,
        json: async () => {
          await bodyArrived;
          if (init.signal.aborted) {
            throw new DOMException("The operation was aborted.", "AbortError");
          }
          return { choices: [{ message: { content: "landscape research" } }] };
        },
      })),
    );

    // Nothing past the research call is under test — an empty batch is the
    // cheapest way to stop right after it.
    generateStructured.mockResolvedValue({ data: { items: [] } });

    vi.useFakeTimers();
    const pending = generateBatch(BLOG_AGENT_CONFIG_STARTER);
    await vi.advanceTimersByTimeAsync(300_000); // well past RESEARCH_TIMEOUT_MS
    releaseBody();

    const result = await pending;

    // "batch was empty" proves the research text got through. The regression
    // this guards reports "research returned nothing" instead.
    expect(result.error).toBe("batch was empty");
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("still gives up when the response itself never arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      ),
    );

    vi.useFakeTimers();
    const pending = generateBatch(BLOG_AGENT_CONFIG_STARTER);
    await vi.advanceTimersByTimeAsync(300_000);

    expect((await pending).error).toBe("research returned nothing");
    expect(generateStructured).not.toHaveBeenCalled();
  });
});
