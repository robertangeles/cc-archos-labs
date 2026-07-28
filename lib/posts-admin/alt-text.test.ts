import { describe, expect, it } from "vitest";
import { ALT_MAX_LEN, trimAltToWordBoundary } from "./alt-text";

// The behaviour being locked in: alt text is cut at a WORD boundary, not
// mid-token. The bare `.slice(0, 125)` this replaces shipped strings like
// "...their shadows cast" and "...visual metaphor for data rea" into
// og:image:alt and the alt attribute of every blog hero image, which is what
// screen readers announce and what LinkedIn shows as fallback text.

const A_WORD = "alpha "; // 6 chars, so 25 of them = 150 > ALT_MAX_LEN

describe("trimAltToWordBoundary", () => {
  it("leaves short text untouched", () => {
    expect(trimAltToWordBoundary("A short description.")).toBe(
      "A short description.",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(trimAltToWordBoundary("  padded  ")).toBe("padded");
  });

  it("returns text exactly at the limit unchanged", () => {
    const exact = "x".repeat(ALT_MAX_LEN);
    expect(trimAltToWordBoundary(exact)).toBe(exact);
    expect(trimAltToWordBoundary(exact)).toHaveLength(ALT_MAX_LEN);
  });

  it("never exceeds the limit", () => {
    const long = A_WORD.repeat(40);
    expect(trimAltToWordBoundary(long).length).toBeLessThanOrEqual(ALT_MAX_LEN);
  });

  it("does not cut mid-word", () => {
    const long = A_WORD.repeat(40);
    const out = trimAltToWordBoundary(long);
    // Every token that survives must be a whole "alpha".
    for (const token of out.split(" ")) {
      expect(token).toBe("alpha");
    }
  });

  it("cuts the real-world string at a word, not mid-token", () => {
    // Verbatim from a published post, where the old slice produced
    // "...their shadows cast" mid-sentence.
    const real =
      "Figure in empty gate lounge at night, facing glass wall. Two identical jet bridges suspended above ground, their shadows casting long parallel lines across the terminal floor";
    const out = trimAltToWordBoundary(real);
    expect(out.length).toBeLessThanOrEqual(ALT_MAX_LEN);
    expect(real.startsWith(out)).toBe(true);
    // The character right after the cut must be a space in the source —
    // that is what "cut at a word boundary" means.
    expect(real[out.length]).toBe(" ");
  });

  it("strips a separator left dangling by the cut", () => {
    // Engineered so the boundary lands immediately after a comma.
    const head = "word ".repeat(23); // 115 chars
    const input = `${head}tail, and then a great deal more text follows here`;
    const out = trimAltToWordBoundary(input);
    expect(out.endsWith(",")).toBe(false);
    expect(out.endsWith(" ")).toBe(false);
  });

  it("falls back to a hard slice when the first token is longer than the limit", () => {
    // No boundary exists to cut at. A truncated word beats empty alt text.
    const oneLongToken = "z".repeat(200);
    const out = trimAltToWordBoundary(oneLongToken);
    expect(out).toHaveLength(ALT_MAX_LEN);
    expect(out).toBe("z".repeat(ALT_MAX_LEN));
  });

  it("handles an empty string", () => {
    expect(trimAltToWordBoundary("")).toBe("");
    expect(trimAltToWordBoundary("   ")).toBe("");
  });

  it("never returns empty text for non-empty input, even when the leading token is all separators", () => {
    // The word-boundary cut lands right after a run of dashes with nothing
    // else before it. Stripping trailing separators from that run alone
    // would collapse the result to "" — a truncated word beats no alt text.
    const input = `${"-".repeat(100)} ${"word".repeat(30)}`;
    const out = trimAltToWordBoundary(input);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(ALT_MAX_LEN);
  });
});
