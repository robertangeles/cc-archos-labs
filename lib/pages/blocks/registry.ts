// Block registry — single source of truth for which block_types exist.
// Maps block_type → { schema, label, description, defaultProps }.
//
// Render-side mapping (block_type → React component) lives at
// components/pages/blocks-renderer.tsx to avoid forcing this module to
// pull React/Next.js imports — it's used by validation paths that run
// in server-only contexts (API route handlers).
//
// Adding a new block_type:
//   1. Add the Zod schema + type to lib/pages/blocks/schemas.ts
//   2. Add the entry to REGISTRY below
//   3. Add the render adapter to components/pages/blocks/
//   4. Wire it into BLOCK_COMPONENTS in components/pages/blocks-renderer.tsx
//   5. Add a test asserting the Zod schema + render fallback path

import {
  CtaPairBlockSchema,
  HeroBlockSchema,
  MarkdownBlockSchema,
  ProofGridBlockSchema,
  ServiceGridBlockSchema,
  type CtaPairBlockProps,
  type HeroBlockProps,
  type MarkdownBlockProps,
  type ProofGridBlockProps,
  type ServiceGridBlockProps,
} from "./schemas";
import type { ZodTypeAny } from "zod";

export interface BlockRegistryEntry<TProps = unknown> {
  /** Human-readable label for the admin block-picker. */
  label: string;
  /** One-sentence description, surfaced in the picker. */
  description: string;
  /** Zod schema validated at admin save AND at render. */
  schema: ZodTypeAny;
  /** Default props for "Add block" — gives the editor a starting point. */
  defaultProps: TProps;
}

export const BLOCK_REGISTRY = {
  hero: {
    label: "Hero",
    description:
      "Eyebrow + headline + subhead + optional primary/secondary CTA buttons. Use as the first block on a marketing page.",
    schema: HeroBlockSchema,
    defaultProps: {
      eyebrow: "Section eyebrow",
      headline: "A clear, specific headline that names the outcome.",
      subhead:
        "One or two sentences that earn the next scroll without overpromising.",
      primaryCta: {
        label: "Book a call",
        href: "/book/archos-labs",
      },
    } as HeroBlockProps,
  },
  proof_grid: {
    label: "Proof grid",
    description:
      "Section heading + 1-6 anonymised proof points. Renders 3-up on desktop; stacks on mobile.",
    schema: ProofGridBlockSchema,
    defaultProps: {
      heading: "What clients ship after working with us.",
      items: [
        { label: "Outcome", outcome: "Concrete, measurable result." },
        { label: "Outcome", outcome: "Concrete, measurable result." },
        { label: "Outcome", outcome: "Concrete, measurable result." },
      ],
    } as ProofGridBlockProps,
  },
  service_grid: {
    label: "Service grid",
    description:
      "Section heading + 1-6 service cards in a 2-up grid. Each card has name + body + deliverable tag.",
    schema: ServiceGridBlockSchema,
    defaultProps: {
      heading: "What we do.",
      services: [
        {
          name: "Service name",
          body: "What the engagement does for the client.",
          deliverable: "Deliverable",
        },
      ],
    } as ServiceGridBlockProps,
  },
  cta_pair: {
    label: "CTA pair",
    description:
      "Primary + optional secondary call-to-action band. Use as a closing or mid-page break.",
    schema: CtaPairBlockSchema,
    defaultProps: {
      position: "final",
      align: "center",
      primary: {
        label: "Book a call",
        href: "/book/archos-labs",
      },
    } as CtaPairBlockProps,
  },
  markdown: {
    label: "Markdown body",
    description:
      "Free-form prose between section blocks. Same renderer as long-form pages (GFM tables, no raw HTML).",
    schema: MarkdownBlockSchema,
    defaultProps: {
      content: "Write the prose here.\n\nSupports **GFM** markdown.",
    } as MarkdownBlockProps,
  },
} as const satisfies Record<string, BlockRegistryEntry>;

export type BlockTypeKey = keyof typeof BLOCK_REGISTRY;

export const BLOCK_TYPES = Object.keys(BLOCK_REGISTRY) as BlockTypeKey[];

/** Type guard: is this string a known block_type? */
export function isKnownBlockType(value: string): value is BlockTypeKey {
  return value in BLOCK_REGISTRY;
}

/**
 * Validate block props against the registry schema. Returns parsed props
 * on success, throws a ZodError on failure. Used by the admin save path
 * before INSERT.
 */
export function parseBlockProps(blockType: string, props: unknown): unknown {
  if (!isKnownBlockType(blockType)) {
    throw new Error(`Unknown block type: ${blockType}`);
  }
  return BLOCK_REGISTRY[blockType].schema.parse(props);
}

/**
 * Safe variant for render-time use. Returns either { ok: true, value }
 * or { ok: false, error } — never throws. The renderer uses this to
 * decide between rendering the block and rendering a placeholder.
 */
export function safeParseBlockProps(
  blockType: string,
  props: unknown,
):
  | { ok: true; value: unknown }
  | { ok: false; error: string } {
  if (!isKnownBlockType(blockType)) {
    return { ok: false, error: `Unknown block type: ${blockType}` };
  }
  const result = BLOCK_REGISTRY[blockType].schema.safeParse(props);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; "),
  };
}
