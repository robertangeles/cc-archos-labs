import { afterEach, describe, expect, it, vi } from "vitest";
import * as analytics from "./analytics";
import {
  trackWatermarkCtaClicked,
  trackWatermarkParseCompleted,
  trackWatermarkParseFailed,
} from "./watermark-analytics";

// The property-level guarantee ("never filename/value/content") is actually
// enforced at compile time by WatermarkParseProps having no index signature
// — a call site passing an extra field fails `tsc`, not this test. What this
// test verifies is the runtime contract: exactly the allowlisted shape
// reaches track(), nothing more, nothing silently added.
const FORBIDDEN_SUBSTRINGS = ["file", "name", "value", "content", "text", "data", "url", "path"];

describe("watermark analytics allowlist", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends exactly the allowlisted shape for a completed parse", () => {
    const spy = vi.spyOn(analytics, "track");
    trackWatermarkParseCompleted({ source: "jpeg", findingsCount: 3, stripped: true });

    expect(spy).toHaveBeenCalledTimes(1);
    const [event, props] = spy.mock.calls[0];
    expect(event).toBe("watermark.parse.completed");
    expect(props).toEqual({ source: "jpeg", findingsCount: 3, stripped: true });
    for (const key of Object.keys(props ?? {})) {
      expect(FORBIDDEN_SUBSTRINGS.some((f) => key.toLowerCase().includes(f))).toBe(false);
    }
  });

  it("sends only the source on a failed parse — no error detail, no partial content", () => {
    const spy = vi.spyOn(analytics, "track");
    trackWatermarkParseFailed("image");

    expect(spy).toHaveBeenCalledWith("watermark.parse.failed", { source: "image" });
    const [, props] = spy.mock.calls[0];
    expect(Object.keys(props ?? {})).toEqual(["source"]);
  });

  it("sends no props at all on CTA click", () => {
    const spy = vi.spyOn(analytics, "track");
    trackWatermarkCtaClicked();

    expect(spy).toHaveBeenCalledWith("watermark.cta.clicked");
    expect(spy.mock.calls[0]).toHaveLength(1);
  });
});
