import { describe, expect, it } from "vitest";
import { computeDiffSizePct } from "./index";

// computeDiffSizePct is the heuristic that powers (a) the "material
// change" badge on revisions, and (b) the >5% threshold that triggers
// embedding regen on save. Mirrors the lib/pages diff exactly — see
// lib/pages/diff.test.ts.

describe("computeDiffSizePct (posts)", () => {
  it("returns 0 when content is unchanged", () => {
    expect(computeDiffSizePct("hello", "hello")).toBe(0);
  });

  it("returns 100 when going from empty to content", () => {
    expect(computeDiffSizePct("", "anything goes here")).toBe(100);
  });

  it("returns a small percentage for a typo fix", () => {
    const before = "x".repeat(1000);
    const after = "x".repeat(999);
    const pct = computeDiffSizePct(before, after);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(1);
  });

  it("caps at 100 for catastrophic deletes", () => {
    const before = "x".repeat(10);
    const after = "x".repeat(1000);
    expect(computeDiffSizePct(before, after)).toBe(100);
  });

  it("treats equal-length content as 0 (length-only heuristic)", () => {
    // Same documented limitation as lib/pages: equal-length swaps
    // register as 0%. The full revision body is always preserved in
    // post_revision, so the "material change" signal is a UX hint
    // rather than an audit signal.
    expect(computeDiffSizePct("aaaa", "bbbb")).toBe(0);
  });

  it("registers as > 5 (embedding-regen threshold) for substantial edits", () => {
    const before = "x".repeat(100);
    const after = "x".repeat(120); // 20% growth
    expect(computeDiffSizePct(before, after)).toBeGreaterThan(5);
  });

  it("stays under the 5% threshold for small typo fixes", () => {
    const before = "x".repeat(1000);
    const after = "x".repeat(1010); // 1% growth
    expect(computeDiffSizePct(before, after)).toBeLessThan(5);
  });
});
