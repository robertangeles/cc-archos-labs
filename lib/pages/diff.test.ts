import { describe, expect, it } from "vitest";
import { computeDiffSizePct } from "./index";

describe("computeDiffSizePct", () => {
  it("returns 0 when content is unchanged", () => {
    expect(computeDiffSizePct("hello", "hello")).toBe(0);
  });

  it("returns 100 when going from empty to content", () => {
    expect(computeDiffSizePct("", "anything goes here")).toBe(100);
  });

  it("returns a small percentage for a typo fix", () => {
    const before = "x".repeat(1000);
    const after = "x".repeat(999); // 0.1% smaller
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
    // Documented limitation: equal-length swaps register as 0%. The
    // "material change" banner is a heuristic, not an audit signal.
    // The full revision body is always preserved in page_revision.
    expect(computeDiffSizePct("aaaa", "bbbb")).toBe(0);
  });
});
