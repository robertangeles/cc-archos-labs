import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { isValidPixelId, metaPixelSnippet, MetaPixel } from "./meta-pixel";

// A malformed id interpolated into the inline fbq snippet could break the
// script or inject. The id must be all-digits before it reaches the string.
describe("isValidPixelId", () => {
  it("accepts an all-digit id", () => {
    expect(isValidPixelId("28739401002314414")).toBe(true);
  });
  it("rejects empty / undefined (dev / preview no-op)", () => {
    expect(isValidPixelId("")).toBe(false);
    expect(isValidPixelId(undefined)).toBe(false);
  });
  it("rejects non-digit / injection attempts", () => {
    expect(isValidPixelId("abc")).toBe(false);
    expect(isValidPixelId("123'); alert(1)//")).toBe(false);
    expect(isValidPixelId("123 456")).toBe(false);
  });
});

describe("metaPixelSnippet", () => {
  it("interpolates the id into init and fires the first PageView", () => {
    const s = metaPixelSnippet("28739401002314414");
    expect(s).toContain("fbq('init','28739401002314414')");
    expect(s).toContain("fbq('track','PageView')");
    expect(s).toContain("connect.facebook.net/en_US/fbevents.js");
  });
});

describe("MetaPixel", () => {
  it("renders nothing when the id is unset or malformed", () => {
    expect(renderToString(<MetaPixel />)).toBe("");
    expect(renderToString(<MetaPixel pixelId="not-a-number" />)).toBe("");
  });
});
