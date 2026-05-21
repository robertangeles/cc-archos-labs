import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDebounceForTests, pingIndexNow } from "./indexnow";

// Tests pin NODE_ENV to 'production' and INDEXNOW_KEY to a known value
// before each case, then restore. Without those, the function short-
// circuits before reaching the fetch call.

const KEY = "test-key-abc123";

describe("pingIndexNow", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INDEXNOW_KEY", KEY);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://archoslabs.xyz");
    __resetDebounceForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips when INDEXNOW_KEY is unset", async () => {
    vi.stubEnv("INDEXNOW_KEY", "");
    const result = await pingIndexNow(["https://archoslabs.xyz/blog/x"]);
    expect(result).toEqual({ status: "skipped", reason: "no-key" });
  });

  it("skips in non-production environments", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = await pingIndexNow(["https://archoslabs.xyz/blog/x"]);
    expect(result).toEqual({ status: "skipped", reason: "non-production" });
  });

  it("skips when the urls list is empty", async () => {
    const result = await pingIndexNow([]);
    expect(result).toEqual({ status: "skipped", reason: "no-urls" });
  });

  it("POSTs the correct payload shape to the global endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    await pingIndexNow([
      "https://archoslabs.xyz/blog/post-a",
      "https://archoslabs.xyz/blog/post-b",
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(init?.method).toBe("POST");
    expect(
      (init?.headers as Record<string, string>)["Content-Type"],
    ).toContain("application/json");
    const body = JSON.parse(init?.body as string);
    // No `keyLocation` — Option 1 (key file at the canonical
    // /{key}.txt URL) means engines auto-fetch and don't need the path
    // hinted in the payload.
    expect(body).toEqual({
      host: "archoslabs.xyz",
      key: KEY,
      urlList: [
        "https://archoslabs.xyz/blog/post-a",
        "https://archoslabs.xyz/blog/post-b",
      ],
    });
  });

  it("dedupes URLs within a single call", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    await pingIndexNow([
      "https://archoslabs.xyz/blog/dup",
      "https://archoslabs.xyz/blog/dup",
      "https://archoslabs.xyz/blog/other",
    ]);

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.urlList).toEqual([
      "https://archoslabs.xyz/blog/dup",
      "https://archoslabs.xyz/blog/other",
    ]);
  });

  it("debounces re-submissions of the same URL within 5 minutes", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    const first = await pingIndexNow(["https://archoslabs.xyz/blog/x"]);
    expect(first.status).toBe("ok");
    expect(first.submitted).toBe(1);

    // Immediate re-submission — debounced.
    const second = await pingIndexNow(["https://archoslabs.xyz/blog/x"]);
    expect(second).toEqual({ status: "skipped", reason: "all-debounced" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("debounces same URL but lets fresh URLs through in a mixed batch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    await pingIndexNow(["https://archoslabs.xyz/blog/cached"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await pingIndexNow([
      "https://archoslabs.xyz/blog/cached",
      "https://archoslabs.xyz/blog/fresh",
    ]);
    expect(second.status).toBe("ok");
    expect(second.submitted).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(body.urlList).toEqual(["https://archoslabs.xyz/blog/fresh"]);
  });

  it("reports failed when the endpoint returns non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 429, statusText: "Too Many Requests" }),
    );
    const result = await pingIndexNow(["https://archoslabs.xyz/blog/x"]);
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(429);
  });

  it("treats 202 (accepted, not yet processed) as success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 202 }),
    );
    const result = await pingIndexNow(["https://archoslabs.xyz/blog/x"]);
    expect(result.status).toBe("ok");
    expect(result.httpStatus).toBe(202);
  });

  it("reports failed when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENOTFOUND"));
    const result = await pingIndexNow(["https://archoslabs.xyz/blog/x"]);
    expect(result.status).toBe("failed");
  });

  it("marks debounce even when the endpoint fails — no flood on next call", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 429 }));

    await pingIndexNow(["https://archoslabs.xyz/blog/x"]);
    const second = await pingIndexNow(["https://archoslabs.xyz/blog/x"]);
    expect(second).toEqual({ status: "skipped", reason: "all-debounced" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
