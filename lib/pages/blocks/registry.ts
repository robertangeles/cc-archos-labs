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
  ClosingStatementBlockSchema,
  CtaPairBlockSchema,
  EditorialEssayBlockSchema,
  EditorialFaqBlockSchema,
  HeroBlockSchema,
  MarkdownBlockSchema,
  ObjectionFaqBlockSchema,
  ProcessStepsBlockSchema,
  ProofGridBlockSchema,
  QuickDiagnosisBlockSchema,
  ServiceGridBlockSchema,
  StatBandBlockSchema,
  TimelineBlockSchema,
  type ClosingStatementBlockProps,
  type CtaPairBlockProps,
  type EditorialEssayBlockProps,
  type EditorialFaqBlockProps,
  type HeroBlockProps,
  type MarkdownBlockProps,
  type ObjectionFaqBlockProps,
  type ProcessStepsBlockProps,
  type ProofGridBlockProps,
  type QuickDiagnosisBlockProps,
  type ServiceGridBlockProps,
  type StatBandBlockProps,
  type TimelineBlockProps,
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
  editorial_essay: {
    label: "Editorial essay",
    description:
      "Long-form thesis section with numbered section counter, emphasised lead paragraph, body paragraphs, optional mid-essay pull-quote, and optional mono signoff. Use for thesis sections that deserve more visual weight than a plain markdown block.",
    schema: EditorialEssayBlockSchema,
    defaultProps: {
      sectionNumber: "01",
      sectionLabel: "Section label",
      heading: "Section heading.",
      leadParagraph:
        "The opening sentence or two that anchor the rest of the section.",
      bodyParagraphs: [
        "Body paragraph one.",
        "Body paragraph two.",
      ],
      pullQuote: "A short, quotable line.",
      pullQuotePosition: "middle",
    } as EditorialEssayBlockProps,
  },
  process_steps: {
    label: "Process steps",
    description:
      "Numbered methodology cards (1-6 steps) with mono numeral, lavender hairline trim, eyebrow label, and body. Echoes the home page Timeline pattern as cards. Use for 'how it works' sections where each step needs more body than a Timeline milestone allows.",
    schema: ProcessStepsBlockSchema,
    defaultProps: {
      sectionNumber: "02",
      sectionLabel: "How it works",
      heading: "Section heading.",
      steps: [
        { label: "Step", body: "What happens in this step." },
        { label: "Step", body: "What happens in this step." },
      ],
    } as ProcessStepsBlockProps,
  },
  editorial_faq: {
    label: "Editorial FAQ",
    description:
      "Designed Q&A for long-form questions that belong on a thesis page. Mono Q —/A — labels in lavender, question at headline scale, answer at body-lg, hairline dividers between items. Not a SaaS help center.",
    schema: EditorialFaqBlockSchema,
    defaultProps: {
      sectionNumber: "03",
      sectionLabel: "Questions",
      heading: "The questions worth answering.",
      items: [
        {
          question: "The first question that matters.",
          answer: "A direct answer that earns the question.",
        },
      ],
    } as EditorialFaqBlockProps,
  },
  closing_statement: {
    label: "Closing statement",
    description:
      "Designed final-section block with eyebrow + heading + lead paragraph + optional pull-quote + primary/secondary CTA pair. Replaces a generic markdown + cta_pair combo when the closing wants editorial weight.",
    schema: ClosingStatementBlockSchema,
    defaultProps: {
      eyebrow: "Ready",
      heading: "Closing heading.",
      leadParagraph: "Closing lead paragraph that earns the click.",
      pullQuote: "A short, memorable closing line.",
      primaryCta: { label: "Primary action", href: "/" },
      secondaryCta: { label: "Secondary action", href: "/" },
    } as ClosingStatementBlockProps,
  },
  stat_band: {
    label: "Stat band",
    description:
      "Full-width 3-column stat strip. Eyebrow + big number + unit + subtext per column. Surface-1 background with hairline top/bottom and vertical dividers between columns on desktop. Stacks on mobile.",
    schema: StatBandBlockSchema,
    defaultProps: {
      stats: [
        {
          eyebrow: "Label",
          number: "1",
          unit: "unit",
          subtext: "Short supporting line.",
        },
        {
          eyebrow: "Label",
          number: "2",
          unit: "unit",
          subtext: "Short supporting line.",
        },
        {
          eyebrow: "Label",
          number: "3",
          unit: "unit",
          subtext: "Short supporting line.",
        },
      ],
    } as StatBandBlockProps,
  },
  timeline: {
    label: "Timeline",
    description:
      "Process or roadmap timeline with lavender dots on a hairline. Mirrors the home page's 90-day timeline pattern exactly. 2-8 milestones.",
    schema: TimelineBlockSchema,
    defaultProps: {
      heading: "Section heading.",
      milestones: [
        { week: "Week 1", label: "Milestone one" },
        { week: "Week 2", label: "Milestone two" },
        { week: "Week 3", label: "Milestone three" },
      ],
    } as TimelineBlockProps,
  },
  objection_faq: {
    label: "Objection FAQ",
    description:
      "Native <details>/<summary> disclosure FAQ matching the home page's ObjectionFaq pattern — plus icon rotates to × on open. Quiet, inline, not a SaaS help center. 1-12 Q/A items, each answer can have multiple paragraphs.",
    schema: ObjectionFaqBlockSchema,
    defaultProps: {
      heading: "Section heading.",
      items: [
        {
          question: "The first objection worth handling.",
          answer: ["The honest answer to it."],
        },
      ],
    } as ObjectionFaqBlockProps,
  },
  quick_diagnosis: {
    label: "Quick diagnosis",
    description:
      "Three single-select questions (sector / program stage / data governance) → one practitioner-voice sentence naming the most likely failure mode. No email required. CTAs to the full assessment + booking. Questions and diagnosis logic are hardcoded in the adapter; only the surrounding copy is admin-editable.",
    schema: QuickDiagnosisBlockSchema,
    defaultProps: {
      eyebrow: "Quick diagnosis",
      heading: "Tell us where you are. We will tell you what is probably wrong.",
      subtext: "Three questions. No email required. One honest answer.",
      disclaimer:
        "This is a general observation based on patterns across programs like yours. The full assessment takes 8 minutes and gives you a scored report your CFO can act on.",
      primaryCta: {
        label: "Take the full assessment",
        href: "/ai-readiness-assessment",
      },
      secondaryCta: {
        label: "Book a 30-minute call",
        href: "/book/archos-labs",
      },
    } as QuickDiagnosisBlockProps,
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
