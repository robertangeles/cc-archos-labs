import { describe, expect, it } from "vitest";
import { MAX_TEXT_LENGTH, TextTooLargeError, stripText } from "./text-metadata";

const zwsp = String.fromCharCode(0x200b);
const nnbsp = String.fromCharCode(0x202f);

describe("stripText", () => {
  it("strips zero-width and narrow-space artifacts and reports findings", () => {
    const input = `Hello${zwsp}World${nnbsp}there`;
    const { cleaned, findings } = stripText(input);
    expect(cleaned).toBe("HelloWorldthere");
    expect(findings).toEqual([
      { id: "zwsp", label: "Zero-width space", detail: "1 occurrence" },
      { id: "nnbsp", label: "Narrow no-break space", detail: "1 occurrence" },
    ]);
  });

  it("strips a tag-block character (astral, surrogate pair) without corrupting adjacent text", () => {
    // U+E0001 (LANGUAGE TAG) sits outside the BMP; an emoji (also astral,
    // different high surrogate) sits right next to it to prove the match
    // doesn't bleed into an unrelated surrogate pair.
    const tagChar = String.fromCodePoint(0xe0001);
    const emoji = String.fromCodePoint(0x1f600);
    const input = `before${tagChar}${emoji}after`;
    const { cleaned, findings } = stripText(input);
    expect(cleaned).toBe(`before${emoji}after`);
    expect(findings).toEqual([
      { id: "tag-block", label: "Unicode tag character", detail: "1 occurrence" },
    ]);
  });

  it("returns no findings and the original text for clean input", () => {
    const input = "Nothing hidden here.";
    const { cleaned, findings } = stripText(input);
    expect(cleaned).toBe(input);
    expect(findings).toEqual([]);
  });

  it("counts multiple occurrences of the same range together", () => {
    const input = `a${zwsp}b${zwsp}c${zwsp}d`;
    const { findings } = stripText(input);
    expect(findings).toEqual([
      { id: "zwsp", label: "Zero-width space", detail: "3 occurrences" },
    ]);
  });

  it("rejects input over the length cap with a typed error", () => {
    const input = "a".repeat(MAX_TEXT_LENGTH + 1);
    expect(() => stripText(input)).toThrow(TextTooLargeError);
  });

  it("rejects non-string input with a typed error", () => {
    // @ts-expect-error deliberately wrong type to verify the guard
    expect(() => stripText(null)).toThrow(TypeError);
  });
});
