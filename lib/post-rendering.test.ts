import { describe, expect, it } from "vitest";
import {
  formatLastReviewed,
  formatPublishedDate,
  generateToc,
  slugifyHeading,
  truncateExcerpt,
} from "./post-rendering";

describe("slugifyHeading", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyHeading("The Archos Labs Framework")).toBe(
      "the-archos-labs-framework",
    );
  });
  it("strips punctuation and collapses dashes", () => {
    expect(slugifyHeading("Why? AI — Strategy!!")).toBe("why-ai-strategy");
  });
  it("trims leading/trailing dashes", () => {
    expect(slugifyHeading("--data quality--")).toBe("data-quality");
  });
  it("caps length at 80", () => {
    const long = "x".repeat(120);
    expect(slugifyHeading(long).length).toBeLessThanOrEqual(80);
  });
});

describe("generateToc", () => {
  it("extracts h2 and h3 in order", () => {
    const md = `# Title\n\n## Section A\n\nbody\n\n### Subsection A1\n\nbody\n\n## Section B\n`;
    const toc = generateToc(md);
    expect(toc.map((h) => [h.level, h.text])).toEqual([
      [2, "Section A"],
      [3, "Subsection A1"],
      [2, "Section B"],
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const md = "## Real\n\n```\n## Fake\n```\n\n## Also real";
    const toc = generateToc(md);
    expect(toc.map((h) => h.text)).toEqual(["Real", "Also real"]);
  });

  it("deduplicates colliding slugs", () => {
    const md = "## Risk\n\nbody\n\n## Risk\n";
    const toc = generateToc(md);
    expect(toc.map((h) => h.id)).toEqual(["risk", "risk-2"]);
  });

  it("excludes h1 (page title)", () => {
    const md = "# H1\n\n## H2\n";
    const toc = generateToc(md);
    expect(toc).toHaveLength(1);
    expect(toc[0].level).toBe(2);
  });

  it("strips inline markdown emphasis from heading text", () => {
    const md = "## **Bold** and *italic*";
    const toc = generateToc(md);
    expect(toc[0].text).toBe("Bold and italic");
  });
});

describe("formatLastReviewed", () => {
  it("returns month + year for lastReviewedAt when present", () => {
    const last = new Date("2026-03-15T00:00:00Z");
    const pub = new Date("2025-01-01T00:00:00Z");
    expect(formatLastReviewed(last, pub)).toMatch(/Mar.*2026/);
  });
  it("falls back to publishedAt when lastReviewedAt is null", () => {
    const pub = new Date("2025-07-04T00:00:00Z");
    expect(formatLastReviewed(null, pub)).toMatch(/Jul.*2025/);
  });
});

describe("formatPublishedDate", () => {
  it("formats day month year", () => {
    const d = new Date("2025-12-25T00:00:00Z");
    expect(formatPublishedDate(d)).toMatch(/25.*Dec.*2025/);
  });
});

describe("truncateExcerpt", () => {
  it("returns text unchanged when shorter than maxLength", () => {
    expect(truncateExcerpt("short", 160)).toBe("short");
  });
  it("returns text unchanged when exactly maxLength", () => {
    const s = "x".repeat(160);
    expect(truncateExcerpt(s, 160)).toBe(s);
  });
  it("truncates at a word boundary and appends an ellipsis", () => {
    const s = "Citigroup paid $136 million for a governance failure that nobody on the board had been formally accountable for, and the ripple effects continue to widen for boards that delayed.";
    const out = truncateExcerpt(s, 80);
    expect(out.length).toBeLessThanOrEqual(82); // 80 + "…" + edge
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/); // no whitespace before ellipsis
    // Word-boundary check: every word before the ellipsis should appear in the source.
    const words = out.slice(0, -1).trim().split(/\s+/);
    for (const w of words) {
      expect(s).toContain(w);
    }
  });
  it("defaults to 160", () => {
    const long = "x".repeat(300);
    const out = truncateExcerpt(long);
    expect(out.length).toBeLessThanOrEqual(161);
  });
  it("strips trailing punctuation before the ellipsis", () => {
    const s = "Lots of stuff, more stuff, and even more stuff to fill the buffer beyond the limit, more, comma, and another, plus, dash — and, finally, the end.";
    const out = truncateExcerpt(s, 40);
    expect(out).not.toMatch(/[,;:.\-—]+…$/);
    expect(out.endsWith("…")).toBe(true);
  });
});
