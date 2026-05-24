import { describe, expect, it } from "vitest";
import { deriveSlugFromTitle } from "./slug-derivation";

// Deterministic stub for the RNG so we can assert exact suffix output.
// Returns the same 4-byte buffer regardless of length asked for; the
// helper only ever asks for 2 or 4 bytes so a 4-byte source is enough.
const fixedRng = (n: number) =>
  Buffer.from(Array.from({ length: n }, (_, i) => 0xab + i));
// fixedRng(2).toString("hex") === "abac"
// fixedRng(4).toString("hex") === "abacadae"

describe("deriveSlugFromTitle — happy path", () => {
  it("slugifies a normal title with a random suffix", () => {
    const slug = deriveSlugFromTitle("Hello World", fixedRng);
    expect(slug).toBe("hello-world-abac");
  });

  it("lower-cases mixed-case input", () => {
    const slug = deriveSlugFromTitle("Why DATA Lineage Matters", fixedRng);
    expect(slug).toBe("why-data-lineage-matters-abac");
  });

  it("collapses runs of non-alphanumeric chars to a single hyphen", () => {
    const slug = deriveSlugFromTitle("Foo  ---  Bar!!! Baz", fixedRng);
    expect(slug).toBe("foo-bar-baz-abac");
  });

  it("trims leading/trailing hyphens before suffixing", () => {
    const slug = deriveSlugFromTitle("  --hello--  ", fixedRng);
    expect(slug).toBe("hello-abac");
  });

  it("strips diacritics via NFKD normalisation", () => {
    const slug = deriveSlugFromTitle("Café résumé naïve", fixedRng);
    expect(slug).toBe("cafe-resume-naive-abac");
  });

  it("caps the body length at 80 chars (suffix not counted)", () => {
    const longTitle = "a".repeat(200);
    const slug = deriveSlugFromTitle(longTitle, fixedRng);
    // 80 char body + "-" + 4 char suffix = 85
    expect(slug.length).toBe(85);
    expect(slug.startsWith("a".repeat(80))).toBe(true);
    expect(slug.endsWith("-abac")).toBe(true);
  });
});

describe("deriveSlugFromTitle — fallback to draft-<hex>", () => {
  it("falls back when title is emoji-only", () => {
    const slug = deriveSlugFromTitle("🎉🎈🎊", fixedRng);
    expect(slug).toBe("draft-abacadae");
  });

  it("falls back when title is whitespace + punctuation only", () => {
    const slug = deriveSlugFromTitle("  --!!--  ", fixedRng);
    expect(slug).toBe("draft-abacadae");
  });

  it("falls back when normalised body is shorter than 3 chars", () => {
    const slug = deriveSlugFromTitle("ab", fixedRng);
    expect(slug).toBe("draft-abacadae");
  });

  it("uses normal path when normalised body is exactly 3 chars", () => {
    const slug = deriveSlugFromTitle("abc", fixedRng);
    expect(slug).toBe("abc-abac");
  });

  it("falls back when title is purely combining marks", () => {
    // Combining acute accent (U+0301) — has no base char to attach to.
    // NFKD leaves it as a combining mark; the regex strips it. Body
    // becomes empty → fallback.
    const slug = deriveSlugFromTitle("́́́", fixedRng);
    expect(slug).toBe("draft-abacadae");
  });
});

describe("deriveSlugFromTitle — collision-retry safety", () => {
  it("produces different slugs on successive calls with a real RNG", () => {
    // Sanity check — without the suffix this would always collide.
    // Using the actual randomBytes (default arg).
    const a = deriveSlugFromTitle("Same Title");
    const b = deriveSlugFromTitle("Same Title");
    expect(a).not.toBe(b);
    expect(a.startsWith("same-title-")).toBe(true);
    expect(b.startsWith("same-title-")).toBe(true);
  });
});
