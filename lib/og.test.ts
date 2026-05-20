import { describe, expect, it } from "vitest";
import { generateOgImage, isOgImageStubbed } from "./og";

describe("isOgImageStubbed", () => {
  it("returns true for null path", () => {
    expect(isOgImageStubbed(null, new Date())).toBe(true);
  });

  it("returns true for empty path", () => {
    expect(isOgImageStubbed("", new Date())).toBe(true);
  });

  it("returns true for null timestamp", () => {
    expect(isOgImageStubbed("/og/foo.png", null)).toBe(true);
  });

  it("returns true for the epoch sentinel timestamp", () => {
    expect(isOgImageStubbed("/og/foo.png", new Date(0))).toBe(true);
  });

  it("returns false for a real path + real timestamp", () => {
    expect(isOgImageStubbed("/og/foo.png", new Date("2026-05-20"))).toBe(false);
  });
});

describe("generateOgImage (stub)", () => {
  it("returns the empty-path sentinel today", async () => {
    // STATUS: lib/og.ts is currently a stub. Once the satori + Geist +
    // R2 pipeline lands, this test should switch to verifying a real
    // R2 URL is returned. Documented here so the test fails loudly
    // when the renderer ships and reminds us to refresh the assertion.
    const result = await generateOgImage({
      slug: "test-post",
      title: "Test Post",
      excerpt: null,
    });
    expect(result.ogImagePath).toBe("");
    expect(result.ogImageGeneratedAt.getTime()).toBe(0);
  });
});
