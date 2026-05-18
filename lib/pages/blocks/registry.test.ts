import { describe, expect, it } from "vitest";
import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  isKnownBlockType,
  parseBlockProps,
  safeParseBlockProps,
} from "./registry";

describe("BLOCK_REGISTRY consistency", () => {
  it("exposes at least the Phase 2 block types", () => {
    expect(BLOCK_TYPES).toEqual(
      expect.arrayContaining([
        "hero",
        "proof_grid",
        "service_grid",
        "cta_pair",
        "markdown",
      ]),
    );
  });

  it("every entry has all required fields", () => {
    for (const bt of BLOCK_TYPES) {
      const entry = BLOCK_REGISTRY[bt];
      expect(entry.label, `${bt}.label`).toBeTruthy();
      expect(entry.description, `${bt}.description`).toBeTruthy();
      expect(entry.schema, `${bt}.schema`).toBeDefined();
      expect(entry.defaultProps, `${bt}.defaultProps`).toBeDefined();
    }
  });

  it("every entry's defaultProps satisfies its own Zod schema", () => {
    // Regression: a registry author adds a new block_type, sets a
    // defaultProps that doesn't match the schema → admin "+ Add block"
    // would land an invalid block that fails save. Catch at test time.
    for (const bt of BLOCK_TYPES) {
      const entry = BLOCK_REGISTRY[bt];
      const result = entry.schema.safeParse(entry.defaultProps);
      expect(
        result.success,
        `${bt}.defaultProps failed schema: ${
          result.success ? "" : JSON.stringify(result.error.issues)
        }`,
      ).toBe(true);
    }
  });
});

describe("isKnownBlockType", () => {
  it("returns true for every registered block_type", () => {
    for (const bt of BLOCK_TYPES) {
      expect(isKnownBlockType(bt)).toBe(true);
    }
  });

  it("returns false for an unknown type", () => {
    expect(isKnownBlockType("nope")).toBe(false);
    expect(isKnownBlockType("")).toBe(false);
    expect(isKnownBlockType("HERO")).toBe(false); // case-sensitive
  });
});

describe("parseBlockProps", () => {
  it("returns parsed props on success", () => {
    const parsed = parseBlockProps("markdown", { content: "hello" });
    expect(parsed).toEqual({ content: "hello" });
  });

  it("throws on unknown block_type", () => {
    expect(() => parseBlockProps("nope", {})).toThrow(/Unknown block type/);
  });

  it("throws on schema violation", () => {
    expect(() =>
      parseBlockProps("hero", { eyebrow: "ok" /* missing required */ }),
    ).toThrow();
  });
});

describe("safeParseBlockProps", () => {
  it("returns ok=true on success", () => {
    const result = safeParseBlockProps("markdown", { content: "hello" });
    expect(result).toEqual({ ok: true, value: { content: "hello" } });
  });

  it("returns ok=false with a precise error message on unknown type", () => {
    const result = safeParseBlockProps("nope", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown block type/);
  });

  it("returns ok=false on schema violation", () => {
    const result = safeParseBlockProps("hero", { eyebrow: 123 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/eyebrow/);
  });

  it("never throws — even on garbage input", () => {
    expect(() =>
      safeParseBlockProps("hero", "not even an object" as unknown),
    ).not.toThrow();
    expect(() =>
      safeParseBlockProps("hero", null as unknown),
    ).not.toThrow();
    expect(() =>
      safeParseBlockProps("hero", undefined as unknown),
    ).not.toThrow();
  });
});

describe("schema enforcement per block_type", () => {
  it("hero rejects missing required headline", () => {
    const result = safeParseBlockProps("hero", {
      eyebrow: "x",
      subhead: "y",
      // headline missing
    });
    expect(result.ok).toBe(false);
  });

  it("hero accepts a minimal valid payload", () => {
    const result = safeParseBlockProps("hero", {
      eyebrow: "About",
      headline: "Headline here",
      subhead: "Subhead here",
    });
    expect(result.ok).toBe(true);
  });

  it("proof_grid rejects empty items array", () => {
    const result = safeParseBlockProps("proof_grid", {
      heading: "Outcomes",
      items: [],
    });
    expect(result.ok).toBe(false);
  });

  it("proof_grid rejects too-many items (>6)", () => {
    const result = safeParseBlockProps("proof_grid", {
      heading: "Outcomes",
      items: Array(7).fill({ label: "x", outcome: "y" }),
    });
    expect(result.ok).toBe(false);
  });

  it("service_grid rejects services without a deliverable tag", () => {
    const result = safeParseBlockProps("service_grid", {
      heading: "Services",
      services: [{ name: "A", body: "B" /* deliverable missing */ }],
    });
    expect(result.ok).toBe(false);
  });

  it("cta_pair requires a primary CTA", () => {
    const missingPrimary = safeParseBlockProps("cta_pair", {
      position: "final",
      // primary missing
    });
    expect(missingPrimary.ok).toBe(false);
  });

  it("markdown rejects content over 200KB", () => {
    const result = safeParseBlockProps("markdown", {
      content: "x".repeat(200_001),
    });
    expect(result.ok).toBe(false);
  });
});
