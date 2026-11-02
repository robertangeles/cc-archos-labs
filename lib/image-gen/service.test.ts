import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// generateImage is the chat workspace's image tool and the news pipeline's photo step.
// The chat tool must behave exactly as before; the pipeline needs its own model and a
// longer timeout, and image-only models reject the "text" modality.

vi.mock("../integration-config", () => ({ getIntegrationConfig: async () => ({ llmApiKey: "sk-test" }) }));
const { generateImage, ImageGenError } = await import("./service");

const okBody = (extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,AAAA" } }] } }], ...extra }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => okBody());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const sent = (i = 0) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string);

describe("generateImage", () => {
  it("defaults to the chat workspace's Gemini model with text and image modalities", async () => {
    const r = await generateImage("a quiet room");
    expect(sent()).toMatchObject({ model: "google/gemini-3.1-flash-image-preview", modalities: ["image", "text"], image_config: { aspect_ratio: "2:3", image_size: "2K" } });
    expect(r).toMatchObject({ imageUrl: "data:image/png;base64,AAAA", model: "google/gemini-3.1-flash-image-preview" });
  });

  it("uses the model it is given, and image-only models get image-only modalities", async () => {
    const r = await generateImage("a quiet room", { model: "bytedance-seed/seedream-5-0-pro", aspectRatio: "21:9" });
    expect(sent()).toMatchObject({ model: "bytedance-seed/seedream-5-0-pro", modalities: ["image"], image_config: { aspect_ratio: "21:9" } });
    expect(r.model).toBe("bytedance-seed/seedream-5-0-pro");
  });

  it.each(["google/gemini-3-pro-image", "openai/gpt-image-2"])("keeps image+text for %s", async (model) => {
    await generateImage("x", { model });
    expect(sent().modalities).toEqual(["image", "text"]);
  });

  it("waits as long as it is told to", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = generateImage("x", { timeoutMs: 120_000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(30_000); // past the 25 s default
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // still waiting at 30 s
    await vi.advanceTimersByTimeAsync(100_000);
    expect(await p).toBeInstanceOf(ImageGenError);
    vi.useRealTimers();
  });

  it("times out at 25 s by default, as before", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = generateImage("x").catch((e) => e);
    await vi.advanceTimersByTimeAsync(26_000);
    expect(await p).toMatchObject({ statusCode: 504 });
    vi.useRealTimers();
  });

  it("rejects an empty prompt and an over-long one", async () => {
    await expect(generateImage("   ")).rejects.toMatchObject({ statusCode: 400 });
    await expect(generateImage("x".repeat(16_001))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("reports a response with no image", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "I cannot do that" } }] }), { status: 200 }));
    await expect(generateImage("x")).rejects.toMatchObject({ statusCode: 422 });
  });

  it("maps 429 and upstream failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await expect(generateImage("x")).rejects.toMatchObject({ statusCode: 429 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "bad" } }), { status: 500 }));
    await expect(generateImage("x")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("strips control characters from the prompt", async () => {
    await generateImage("a\u0000 quiet\u0007 room");
    expect(sent().messages[0].content).toBe("a quiet room");
  });
});
