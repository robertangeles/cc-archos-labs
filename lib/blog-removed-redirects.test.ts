import { describe, expect, it } from "vitest";
import redirects from "./blog-removed-redirects.json";

describe("blog-removed-redirects", () => {
  it("has unique sources", () => {
    const sources = redirects.map((r) => r.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("never redirects to another removed URL (no chains, no loops)", () => {
    const sources = new Set(redirects.map((r) => r.source));
    const chained = redirects.filter((r) => sources.has(r.destination));
    expect(chained).toEqual([]);
  });

  it("only redirects /blog/<slug> to /blog or /blog/<slug>, permanently", () => {
    for (const r of redirects) {
      expect(r.source).toMatch(/^\/blog\/[a-z0-9-]+$/);
      expect(r.destination).toMatch(/^\/blog(\/[a-z0-9-]+)?$/);
      expect(r.permanent).toBe(true);
    }
  });
});
