// Zod-schema introspection — classifies a Zod schema into a normalised
// FieldDescriptor that the per-field form renderer (`<ZodForm>`) uses
// to emit the right input per field.
//
// This module is the contract between Zod and the editor UI. The Zod 4
// API exposes:
//   - schema.def.type      → 'object' | 'string' | 'number' | 'boolean'
//                            | 'enum' | 'array' | 'optional' | 'nullable'
//                            | 'literal' | ... (open union)
//   - schema.def.shape     → object's field map (key → Zod schema)
//   - schema.def.element   → array's element schema
//   - schema.def.innerType → optional/nullable wrapper's inner schema
//   - schema.def.entries   → enum's options ({a:'a',b:'b'} record)
//   - schema.def.checks[]  → array of { _zod.def: { check, minimum, maximum } }
//
// If Zod's internal API changes between minor versions, update this
// single file — every downstream consumer (the renderer, tests) sees
// only the normalised FieldDescriptor union.
//
// Coverage: the Phase 2 block schemas use only string / object / array
// of object / enum / optional. Other Zod constructs (union, intersection,
// transform, refine, tuple) fall through to `{ kind: 'unknown' }` which
// the renderer surfaces as a "JSON edit only" placeholder. Future
// block_types adding unsupported shapes get a graceful fallback, not a
// crash.

import type { ZodTypeAny } from "zod";

export type FieldDescriptor =
  | { kind: "string"; min?: number; max?: number; required: boolean }
  | { kind: "longString"; min?: number; max?: number; required: boolean }
  | { kind: "number"; min?: number; max?: number; required: boolean }
  | { kind: "boolean"; required: boolean }
  | { kind: "enum"; options: readonly string[]; required: boolean }
  | { kind: "literal"; value: string | number | boolean; required: boolean }
  | {
      kind: "object";
      fields: Record<string, FieldDescriptor>;
      required: boolean;
    }
  | {
      kind: "array";
      itemDescriptor: FieldDescriptor;
      minItems?: number;
      maxItems?: number;
      required: boolean;
    }
  | { kind: "unknown"; reason: string; required: boolean };

// Threshold for promoting a string field to a textarea (longString).
// Markdown content has max=200_000; SEO description max=300; a hero
// subhead has max=800. Anything generous enough to be multi-line is a
// textarea; short inputs stay inline.
const LONG_STRING_THRESHOLD = 200;

interface IntrospectionContext {
  required: boolean;
}

export function classifySchema(schema: ZodTypeAny): FieldDescriptor {
  return classifyInner(schema, { required: true });
}

function classifyInner(
  schema: ZodTypeAny,
  ctx: IntrospectionContext,
): FieldDescriptor {
  // Zod exposes the public surface via `.def`; we cast to access the
  // shape we know exists at runtime. If a future Zod release relocates
  // this surface, the failure mode is a typecheck mismatch here, not a
  // runtime crash — the test suite catches it before merge.
  const def = (schema as unknown as { def: { type: string } }).def;
  const type = def.type;

  switch (type) {
    case "optional":
    case "nullable":
    case "default": {
      const innerType = (def as unknown as { innerType: ZodTypeAny })
        .innerType;
      // Wrapped fields are not required. Default behaves like optional
      // for UI purposes (a default exists but the user may override).
      return classifyInner(innerType, { required: false });
    }
    case "string": {
      const checks = collectChecks(def);
      const max = pickNumber(checks, "max_length", "maximum");
      const min = pickNumber(checks, "min_length", "minimum");
      const useLong =
        (max !== undefined && max >= LONG_STRING_THRESHOLD) ||
        // No max defined → assume short input; an unbounded markdown body
        // is the exception and is caught by the explicit threshold above
        // (markdown's z.string().max(200_000)).
        false;
      return {
        kind: useLong ? "longString" : "string",
        min,
        max,
        required: ctx.required,
      };
    }
    case "number":
    case "int":
    case "bigint": {
      const checks = collectChecks(def);
      return {
        kind: "number",
        min: pickNumber(checks, "greater_than", "minimum"),
        max: pickNumber(checks, "less_than", "maximum"),
        required: ctx.required,
      };
    }
    case "boolean":
      return { kind: "boolean", required: ctx.required };
    case "enum": {
      const entries = (def as unknown as { entries: Record<string, string> })
        .entries;
      return {
        kind: "enum",
        options: Object.values(entries) as readonly string[],
        required: ctx.required,
      };
    }
    case "literal": {
      const value = (def as unknown as { values: unknown[] }).values?.[0];
      return {
        kind: "literal",
        value: value as string | number | boolean,
        required: ctx.required,
      };
    }
    case "object": {
      const shapeSource = (
        def as unknown as { shape: Record<string, ZodTypeAny> }
      ).shape;
      const fields: Record<string, FieldDescriptor> = {};
      for (const [key, child] of Object.entries(shapeSource)) {
        fields[key] = classifyInner(child, { required: true });
      }
      return { kind: "object", fields, required: ctx.required };
    }
    case "array": {
      const element = (def as unknown as { element: ZodTypeAny }).element;
      const checks = collectChecks(def);
      return {
        kind: "array",
        itemDescriptor: classifyInner(element, { required: true }),
        minItems: pickNumber(checks, "min_length", "minimum"),
        maxItems: pickNumber(checks, "max_length", "maximum"),
        required: ctx.required,
      };
    }
    case "record":
    case "union":
    case "intersection":
    case "tuple":
    case "pipe":
    case "transform":
    case "promise":
      return {
        kind: "unknown",
        reason: `Field kind "${type}" not yet supported by the per-field editor — edit as JSON.`,
        required: ctx.required,
      };
    default:
      return {
        kind: "unknown",
        reason: `Unrecognised Zod type "${type}".`,
        required: ctx.required,
      };
  }
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

interface CheckDef {
  check: string;
  minimum?: number;
  maximum?: number;
  value?: number;
}

function collectChecks(def: unknown): CheckDef[] {
  const checks =
    (def as { checks?: Array<{ _zod?: { def?: CheckDef } }> }).checks ?? [];
  return checks
    .map((c) => c._zod?.def)
    .filter((d): d is CheckDef => Boolean(d));
}

/**
 * Find the first check matching one of the `kinds` and return its
 * numeric bound from either `minimum` or `maximum` (whichever is
 * present). The Zod 4 check shape names the bound differently per
 * check (e.g. min_length carries `minimum`, less_than carries `value`),
 * so we try a few common field names.
 */
function pickNumber(checks: CheckDef[], ...kinds: string[]): number | undefined {
  for (const c of checks) {
    if (!kinds.includes(c.check)) continue;
    if (typeof c.minimum === "number") return c.minimum;
    if (typeof c.maximum === "number") return c.maximum;
    if (typeof c.value === "number") return c.value;
  }
  return undefined;
}
