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

  it("gates consent before init (revoke on reject or EEA timezone)", () => {
    const s = metaPixelSnippet("28739401002314414");
    expect(s).toContain("fbq('consent','revoke')");
    expect(s).toContain("archos_consent"); // reads the stored choice
    expect(s).toContain("Europe/"); // dependency-free EEA heuristic
    // revoke must precede init so the pixel is gated from the start
    expect(s.indexOf("fbq('consent','revoke')")).toBeLessThan(
      s.indexOf("fbq('init'"),
    );
  });
});

describe("MetaPixel", () => {
  it("renders nothing when the id is unset or malformed", () => {
    expect(renderToString(<MetaPixel />)).toBe("");
    expect(renderToString(<MetaPixel pixelId="not-a-number" />)).toBe("");
  });
});
