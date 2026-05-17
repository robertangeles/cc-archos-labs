import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "./analytics";

// Contract: track() never throws, never blocks UX. The caller is responsible
// for not passing sensitive props (URL query strings, IPs, user agents) —
// these tests verify the network shape and non-throwing guarantees, not
// content policy.

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

function setWindow(value: unknown) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
  });
}

describe("track", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setWindow(originalWindow);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    vi.unstubAllEnvs();
  });

  it("is a no-op when window is undefined (server)", () => {
    setWindow(undefined);
    const fetchSpy = vi.fn();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchSpy,
    });
    expect(() => track("page.viewed", { route: "/" })).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs to console in non-production environments", () => {
    setWindow({});
    vi.stubEnv("NODE_ENV", "development");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    track("cta.assessment.clicked", { position: "hero" });
    expect(logSpy).toHaveBeenCalledWith(
      "[analytics]",
      "cta.assessment.clicked",
      { position: "hero" },
    );
  });

  it("POSTs to /api/events with the expected shape in production", () => {
    setWindow({});
    vi.stubEnv("NODE_ENV", "production");

    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}"));
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchSpy,
    });

    track("scroll.depth", { pct: 50 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/events");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    });

    const body = JSON.parse((init as { body: string }).body);
    expect(body.event).toBe("scroll.depth");
    expect(body.props).toEqual({ pct: 50 });
    expect(typeof body.ts).toBe("number");
  });

  it("swallows fetch failures silently in production", () => {
    setWindow({});
    vi.stubEnv("NODE_ENV", "production");

    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchSpy,
    });

    expect(() => track("page.viewed", { route: "/" })).not.toThrow();
  });
});
