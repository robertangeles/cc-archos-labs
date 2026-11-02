import { describe, expect, it, vi } from "vitest";
import { LlmError, makeOpenRouterLlm } from "./llm";

// No test touches the network: makeOpenRouterLlm takes an injected fetch and an
// injected sleep, so retry timing costs nothing.

const ok = (over: Record<string, unknown> = {}, status = 200) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 22, cost: 0.0123 },
      ...over,
    }),
    { status },
  );
const fail = (status: number, message = "nope") =>
  new Response(JSON.stringify({ error: { message } }), { status });

const build = (responses: (Response | Error)[], extra: Record<string, unknown> = {}) => {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("fetch called more times than the test expected");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const sleep = vi.fn(async () => {});
  const llm = makeOpenRouterLlm({ apiKey: async () => "sk-test-key-123", fetchImpl, sleep, ...extra });
  return { llm, fetchImpl, sleep };
};
const req = { label: "t", model: "m/x", user: "hi" };
const body = (f: ReturnType<typeof vi.fn>, call = 0) => JSON.parse((f.mock.calls[call][1] as RequestInit).body as string);

describe("makeOpenRouterLlm: a good answer", () => {
  it("returns text, tokens and cost", async () => {
    const { llm } = build([ok()]);
    const r = await llm(req);
    expect(r).toMatchObject({ text: "hello", inputTokens: 11, outputTokens: 22, costUsd: 0.0123, model: "m/x" });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the key, the model, the system and user messages and a token budget", async () => {
    const { llm, fetchImpl } = build([ok()]);
    await llm({ ...req, system: "be brief", maxTokens: 777, temperature: 0.2 });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-key-123");
    expect(body(fetchImpl)).toMatchObject({
      model: "m/x",
      max_tokens: 777,
      temperature: 0.2,
      messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
    });
  });

  it("gives a reasoning model room to think and write when the caller sets no budget", async () => {
    const { llm, fetchImpl } = build([ok()]);
    await llm(req);
    expect(body(fetchImpl).max_tokens).toBe(32_000); // a real essay ran out of 16,000
  });

  it("omits the system message when there is none", async () => {
    const { llm, fetchImpl } = build([ok()]);
    await llm(req);
    expect(body(fetchImpl).messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("asks for JSON when told to", async () => {
    const { llm, fetchImpl } = build([ok()]);
    await llm({ ...req, json: true });
    expect(body(fetchImpl).response_format).toEqual({ type: "json_object" });
  });

  it("joins a content array of text parts", async () => {
    const { llm } = build([ok({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }, finish_reason: "stop" }] })]);
    expect((await llm(req)).text).toBe("ab");
  });

  it("returns url citations when the model gives them", async () => {
    const { llm } = build([
      ok({ choices: [{ message: { content: "x", annotations: [{ type: "url_citation", url_citation: { url: "https://a.example/p", title: "A" } }, { type: "other" }] }, finish_reason: "stop" }] }),
    ]);
    expect((await llm(req)).citations).toEqual([{ url: "https://a.example/p", title: "A" }]);
  });

  it("tolerates a missing usage block", async () => {
    const { llm } = build([ok({ usage: undefined })]);
    expect(await llm(req)).toMatchObject({ inputTokens: null, outputTokens: null, costUsd: null });
  });
});

describe("makeOpenRouterLlm: failures", () => {
  it.each([503, 502, 500, 429])("retries a %i and then succeeds", async (status) => {
    const { llm, fetchImpl, sleep } = build([fail(status), ok()]);
    expect((await llm(req)).text).toBe("hello");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries a network error", async () => {
    const { llm, fetchImpl } = build([new TypeError("fetch failed"), ok()]);
    expect((await llm(req)).text).toBe("hello");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a timeout", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    const { llm } = build([timeout, ok()]);
    expect((await llm(req)).text).toBe("hello");
  });

  it("gives up after three tries and says why", async () => {
    const { llm, fetchImpl } = build([fail(503), fail(503), fail(503)]);
    await expect(llm(req)).rejects.toMatchObject({ name: "LlmError", kind: "upstream", status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 402, 404, 422])("does not retry a %i", async (status) => {
    const { llm, fetchImpl } = build([fail(status), ok()]);
    await expect(llm(req)).rejects.toBeInstanceOf(LlmError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout as a timeout", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    const { llm } = build([timeout, timeout, timeout]);
    await expect(llm(req)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("a cut-off answer is an error, not a short draft", async () => {
    const { llm, fetchImpl } = build([ok({ choices: [{ message: { content: "The dataset" }, finish_reason: "length" }] })]);
    await expect(llm(req)).rejects.toMatchObject({ kind: "truncated" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // retrying the same budget would cut off again
  });

  it("an empty answer is an error", async () => {
    const { llm } = build([ok({ choices: [{ message: { content: "  " }, finish_reason: "stop" }] }), ok({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }), ok({ choices: [] })]);
    await expect(llm(req)).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("a body that is not JSON is an error", async () => {
    const { llm } = build([new Response("<html>", { status: 200 }), new Response("<html>", { status: 200 }), new Response("<html>", { status: 200 })]);
    await expect(llm(req)).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("no API key is a setup problem, reported before any request", async () => {
    const fetchImpl = vi.fn();
    const llm = makeOpenRouterLlm({ apiKey: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(llm(req)).rejects.toMatchObject({ kind: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never puts the API key in an error message", async () => {
    const { llm } = build([fail(401, "bad key sk-test-key-123")]);
    const err = await llm(req).catch((e) => e);
    expect(String(err.message)).not.toContain("sk-test-key-123");
  });

  it("keeps a provider message short", async () => {
    const { llm } = build([fail(400, "x".repeat(5000))]);
    const err = await llm(req).catch((e) => e);
    expect(err.message.length).toBeLessThan(400);
  });
});
