import { describe, expect, it } from "vitest";
import { z } from "zod";
import { classifySchema, type FieldDescriptor } from "./field-introspection";
import { BLOCK_REGISTRY } from "./registry";

describe("classifySchema — primitives", () => {
  it("classifies a required string", () => {
    const desc = classifySchema(z.string().min(1).max(80));
    expect(desc).toEqual({
      kind: "string",
      min: 1,
      max: 80,
      required: true,
    });
  });

  it("promotes a long-max string to longString (textarea)", () => {
    const desc = classifySchema(z.string().max(500));
    expect(desc.kind).toBe("longString");
  });

  it("classifies a boolean", () => {
    const desc = classifySchema(z.boolean());
    expect(desc).toEqual({ kind: "boolean", required: true });
  });

  it("classifies an enum with its options", () => {
    const desc = classifySchema(z.enum(["a", "b", "c"]));
    expect(desc.kind).toBe("enum");
    if (desc.kind === "enum") {
      expect(desc.options).toEqual(["a", "b", "c"]);
    }
  });

  it("classifies a number with bounds", () => {
    const desc = classifySchema(z.number().min(0).max(100));
    expect(desc.kind).toBe("number");
  });
});

describe("classifySchema — wrappers", () => {
  it("marks optional fields as not required", () => {
    const desc = classifySchema(z.string().optional());
    expect(desc.required).toBe(false);
  });

  it("marks nullable fields as not required", () => {
    const desc = classifySchema(z.string().nullable());
    expect(desc.required).toBe(false);
  });

  it("unwraps optional<object> back to an object descriptor", () => {
    const desc = classifySchema(
      z.object({ x: z.string() }).optional(),
    );
    expect(desc.kind).toBe("object");
    expect(desc.required).toBe(false);
  });
});

describe("classifySchema — compound shapes", () => {
  it("classifies an object with mixed fields", () => {
    const desc = classifySchema(
      z.object({
        name: z.string().min(1).max(80),
        bio: z.string().max(500).optional(),
        age: z.number(),
      }),
    );
    expect(desc.kind).toBe("object");
    if (desc.kind === "object") {
      expect(Object.keys(desc.fields)).toEqual(["name", "bio", "age"]);
      expect(desc.fields.name.required).toBe(true);
      expect(desc.fields.bio.required).toBe(false);
      expect(desc.fields.age.kind).toBe("number");
    }
  });

  it("classifies an array of objects with min/max items", () => {
    const desc = classifySchema(
      z
        .array(z.object({ label: z.string(), outcome: z.string() }))
        .min(1)
        .max(6),
    );
    expect(desc.kind).toBe("array");
    if (desc.kind === "array") {
      expect(desc.minItems).toBe(1);
      expect(desc.maxItems).toBe(6);
      expect(desc.itemDescriptor.kind).toBe("object");
    }
  });

  it("classifies a deeply nested shape", () => {
    const desc = classifySchema(
      z.object({
        cta: z
          .object({
            label: z.string(),
            href: z.string(),
          })
          .optional(),
      }),
    );
    expect(desc.kind).toBe("object");
    if (desc.kind === "object") {
      const ctaDesc = desc.fields.cta;
      expect(ctaDesc.kind).toBe("object");
      expect(ctaDesc.required).toBe(false);
    }
  });
});

describe("classifySchema — unsupported shapes degrade gracefully", () => {
  it("returns 'unknown' for record (not yet supported)", () => {
    const desc = classifySchema(z.record(z.string(), z.unknown()));
    expect(desc.kind).toBe("unknown");
  });

  it("returns 'unknown' for union", () => {
    const desc = classifySchema(z.union([z.string(), z.number()]));
    expect(desc.kind).toBe("unknown");
  });

  it("returns 'unknown' for tuple", () => {
    const desc = classifySchema(z.tuple([z.string(), z.number()]));
    expect(desc.kind).toBe("unknown");
  });
});

describe("Block registry schemas — every one produces a renderable descriptor", () => {
  // Regression: a future block author writes a schema using a Zod
  // construct the classifier doesn't handle. Without this test the
  // editor degrades silently. With it, CI catches the gap.
  for (const [blockType, entry] of Object.entries(BLOCK_REGISTRY)) {
    it(`classifies ${blockType} as a top-level object with renderable fields`, () => {
      const desc = classifySchema(entry.schema);
      expect(
        desc.kind,
        `expected ${blockType} to be a top-level object`,
      ).toBe("object");
      if (desc.kind !== "object") return;

      // Every field should be classifiable. Walk the tree and assert
      // no 'unknown' kinds at the top level of the block's shape.
      // (Nested objects may legitimately contain unknown leaves later;
      // we surface a warning in the renderer for those.)
      for (const [fieldName, fieldDesc] of Object.entries(desc.fields)) {
        expect(
          fieldDesc.kind,
          `${blockType}.${fieldName} should not be 'unknown' — extend field-introspection.ts`,
        ).not.toBe("unknown");
      }
    });
  }
});

describe("classifySchema — Phase 2 block specifics", () => {
  it("hero schema produces all expected fields", () => {
    const desc = classifySchema(BLOCK_REGISTRY.hero.schema) as Extract<
      FieldDescriptor,
      { kind: "object" }
    >;
    expect(desc.fields.eyebrow.required).toBe(true);
    expect(desc.fields.headline.required).toBe(true);
    expect(desc.fields.subhead.required).toBe(true);
    expect(desc.fields.primaryCta.required).toBe(false);
    expect(desc.fields.secondaryCta.required).toBe(false);
    expect(desc.fields.primaryCta.kind).toBe("object");
  });

  it("proof_grid items array is bounded 1..6", () => {
    const desc = classifySchema(
      BLOCK_REGISTRY.proof_grid.schema,
    ) as Extract<FieldDescriptor, { kind: "object" }>;
    const items = desc.fields.items;
    expect(items.kind).toBe("array");
    if (items.kind === "array") {
      expect(items.minItems).toBe(1);
      expect(items.maxItems).toBe(6);
    }
  });

  it("cta_pair position enum carries the four options", () => {
    const desc = classifySchema(BLOCK_REGISTRY.cta_pair.schema) as Extract<
      FieldDescriptor,
      { kind: "object" }
    >;
    const pos = desc.fields.position;
    expect(pos.kind).toBe("enum");
    if (pos.kind === "enum") {
      expect(pos.options).toEqual([
        "hero",
        "assessment-block",
        "final",
        "sticky-mobile",
      ]);
    }
  });
});
