import { describe, expect, it } from "vitest";
import { computeWordCount, readingTimeMinutes } from "./word-count";

describe("computeWordCount", () => {
  it("returns 0 for empty string", () => {
    expect(computeWordCount("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(computeWordCount("   \n\n  \t  ")).toBe(0);
  });

  it("counts simple prose", () => {
    expect(computeWordCount("The quick brown fox jumps over the lazy dog.")).toBe(9);
  });

  it("ignores fenced code blocks", () => {
    const md = `Hello world.

\`\`\`typescript
const x = 1;
const y = 2;
console.log(x, y);
\`\`\`

Goodbye.`;
    // Should count "Hello world. Goodbye." — 3 words.
    expect(computeWordCount(md)).toBe(3);
  });

  it("ignores inline code", () => {
    expect(computeWordCount("Use `useEffect` for side effects.")).toBe(4);
  });

  it("keeps link text but drops URLs", () => {
    expect(computeWordCount("See the [docs](https://example.com/docs/foo) here.")).toBe(4);
  });

  it("keeps image alt text but drops URLs", () => {
    expect(computeWordCount("![architecture diagram](https://example.com/img.png)")).toBe(2);
  });

  it("ignores markdown formatting markers", () => {
    // **bold** → bold, *italic* → italic, ~~strike~~ → strike
    // → "bold and italic and strike text" = 6 words
    expect(computeWordCount("**bold** and *italic* and ~~strike~~ text")).toBe(6);
  });

  it("ignores heading hashes", () => {
    expect(computeWordCount("# Heading one\n\n## Heading two\n\nBody.")).toBe(5);
  });

  it("ignores blockquote markers", () => {
    expect(computeWordCount("> Quoted text here\n>\n> More quote.")).toBe(5);
  });

  it("ignores list bullets at line start", () => {
    expect(computeWordCount("- first item\n- second item\n+ third item")).toBe(6);
  });
});

describe("readingTimeMinutes", () => {
  it("returns 0 for zero words", () => {
    expect(readingTimeMinutes(0)).toBe(0);
  });

  it("returns 0 for negative input (defensive)", () => {
    expect(readingTimeMinutes(-5)).toBe(0);
  });

  it("returns 1 for a tiny post (rounds up the minimum)", () => {
    expect(readingTimeMinutes(50)).toBe(1);
  });

  it("returns 1 for ~220 words (one minute at 220wpm)", () => {
    expect(readingTimeMinutes(220)).toBe(1);
  });

  it("returns 5 for ~1100 words", () => {
    expect(readingTimeMinutes(1100)).toBe(5);
  });

  it("rounds to nearest minute", () => {
    // 330 words / 220 wpm = 1.5 → rounds to 2
    expect(readingTimeMinutes(330)).toBe(2);
    // 320 words / 220 wpm ≈ 1.45 → rounds to 1
    expect(readingTimeMinutes(320)).toBe(1);
  });
});
