import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  isValidGaId,
  ga4ConfigSnippet,
  GoogleAnalytics,
} from "./google-analytics";

// A malformed id interpolated into the inline gtag snippet could break the
// script or inject. The id must match G-[A-Z0-9]+ before it reaches the string.
describe("isValidGaId", () => {
  it("accepts a well-formed Measurement ID", () => {
    expect(isValidGaId("G-LLN8BG92ZT")).toBe(true);
  });
  it("rejects empty / undefined (dev / preview no-op)", () => {
    expect(isValidGaId("")).toBe(false);
    expect(isValidGaId(undefined)).toBe(false);
  });
  it("rejects malformed / injection attempts", () => {
    expect(isValidGaId("LLN8BG92ZT")).toBe(false); // missing G- prefix
    expect(isValidGaId("G-abc")).toBe(false); // lowercase not allowed
    expect(isValidGaId("G-123'); alert(1)//")).toBe(false);
    expect(isValidGaId("UA-12345-1")).toBe(false); // old Universal Analytics
  });
});

describe("ga4ConfigSnippet", () => {
  it("interpolates the id into gtag config", () => {
    const s = ga4ConfigSnippet("G-LLN8BG92ZT");
    expect(s).toContain("gtag('config','G-LLN8BG92ZT')");
    expect(s).toContain("gtag('js',new Date())");
    expect(s).toContain("dataLayer");
  });
});

describe("GoogleAnalytics", () => {
  // next/script afterInteractive tags are injected client-side, so the loader
  // URL is verified by the headless-browser smoke, not renderToString. Here we
  // only assert the no-op guard (which returns null before any <Script>).
  it("renders nothing when the id is unset or malformed", () => {
    expect(renderToString(<GoogleAnalytics />)).toBe("");
    expect(renderToString(<GoogleAnalytics gaId="nope" />)).toBe("");
  });
});
