import { z } from "zod";

// Zod schemas per block_type. The registry exposes these for two
// validations: admin save (rejects bad props before INSERT) and render
// (rejects bad props before passing into the adapter component).
// Render-time validation must NEVER throw — the renderer catches +
// shows a placeholder instead.
//
// Field shapes deliberately track the section components they adapt to
// at components/sections/home and components/sections/about. Keep these
// in sync if those components change props.

// Reusable atoms.
const NonEmptyString = z.string().min(1).max(500);
const ShortString = z.string().min(1).max(200);
const Slug = z.string().min(1).max(200);

const CtaSchema = z.object({
  label: ShortString,
  href: Slug,
  microcopy: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// hero — eyebrow + headline + subhead + optional CTA pair
// ---------------------------------------------------------------------------

export const HeroBlockSchema = z.object({
  eyebrow: z.string().min(1).max(80),
  headline: NonEmptyString,
  subhead: z.string().max(800),
  primaryCta: CtaSchema.optional(),
  secondaryCta: CtaSchema.optional(),
});

export type HeroBlockProps = z.infer<typeof HeroBlockSchema>;

// ---------------------------------------------------------------------------
// proof_grid — section heading + 1-6 ProofItems in a horizontal grid
// ---------------------------------------------------------------------------

export const ProofGridBlockSchema = z.object({
  eyebrow: z.string().max(80).optional(),
  heading: NonEmptyString,
  items: z
    .array(
      z.object({
        label: ShortString,
        outcome: NonEmptyString,
      }),
    )
    .min(1)
    .max(6),
});

export type ProofGridBlockProps = z.infer<typeof ProofGridBlockSchema>;

// ---------------------------------------------------------------------------
// service_grid — section heading + 1-6 ServiceCards in a 2x2-ish grid
// ---------------------------------------------------------------------------

export const ServiceGridBlockSchema = z.object({
  eyebrow: z.string().max(80).optional(),
  heading: NonEmptyString,
  services: z
    .array(
      z.object({
        name: ShortString,
        body: NonEmptyString,
        deliverable: z.string().min(1).max(80),
      }),
    )
    .min(1)
    .max(6),
});

export type ServiceGridBlockProps = z.infer<typeof ServiceGridBlockSchema>;

// ---------------------------------------------------------------------------
// cta_pair — primary + optional secondary CTA, used as standalone band
// ---------------------------------------------------------------------------

export const CtaPairBlockSchema = z.object({
  position: z.enum(["hero", "assessment-block", "final", "sticky-mobile"]),
  align: z.enum(["left", "center"]).optional(),
  primary: CtaSchema,
  secondary: CtaSchema.optional(),
});

export type CtaPairBlockProps = z.infer<typeof CtaPairBlockSchema>;

// ---------------------------------------------------------------------------
// markdown — free-form markdown body for prose between section blocks.
// Rendered through the same react-markdown + remark-gfm pipeline as
// MarkdownArticle (no rehype-raw — XSS posture preserved).
// ---------------------------------------------------------------------------

export const MarkdownBlockSchema = z.object({
  content: z.string().max(200_000),
});

export type MarkdownBlockProps = z.infer<typeof MarkdownBlockSchema>;

// ---------------------------------------------------------------------------
// editorial_essay — long-form section with editorial typographic moves:
// numbered section label, emphasised lead paragraph, body paragraphs,
// optional pull-quote, optional signoff. Use this for thesis sections
// that deserve more visual weight than the universal markdown block.
// ---------------------------------------------------------------------------

export const EditorialEssayBlockSchema = z.object({
  sectionNumber: z.string().min(1).max(8),
  sectionLabel: z.string().min(1).max(80),
  heading: NonEmptyString,
  leadParagraph: z.string().min(1).max(2000),
  bodyParagraphs: z.array(z.string().min(1).max(2000)).min(0).max(20),
  pullQuote: z.string().max(400).optional(),
  pullQuotePosition: z.enum(["middle", "end"]).optional(),
  signoff: z.string().max(120).optional(),
});

export type EditorialEssayBlockProps = z.infer<typeof EditorialEssayBlockSchema>;

// ---------------------------------------------------------------------------
// process_steps — numbered process or methodology cards. 1-6 steps with
// large mono numerals, lavender hairline trim, eyebrow label, headline,
// body text. Echoes the Timeline pattern from the home page (dots on a
// hairline) but as cards.
// ---------------------------------------------------------------------------

export const ProcessStepsBlockSchema = z.object({
  sectionNumber: z.string().min(1).max(8),
  sectionLabel: z.string().min(1).max(80),
  heading: NonEmptyString,
  intro: z.string().max(400).optional(),
  steps: z
    .array(
      z.object({
        label: ShortString,
        body: z.string().min(1).max(600),
      }),
    )
    .min(1)
    .max(6),
});

export type ProcessStepsBlockProps = z.infer<typeof ProcessStepsBlockSchema>;

// ---------------------------------------------------------------------------
// editorial_faq — designed Q&A section with mono Q/A labels in lavender,
// question at headline scale, answer at body-lg, hairline divider
// between items. NOT a SaaS help center.
// ---------------------------------------------------------------------------

export const EditorialFaqBlockSchema = z.object({
  sectionNumber: z.string().min(1).max(8),
  sectionLabel: z.string().min(1).max(80),
  heading: NonEmptyString,
  leadParagraph: z.string().max(800).optional(),
  items: z
    .array(
      z.object({
        question: NonEmptyString,
        answer: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(10),
});

export type EditorialFaqBlockProps = z.infer<typeof EditorialFaqBlockSchema>;

// ---------------------------------------------------------------------------
// closing_statement — final-section block with eyebrow + heading + lead
// paragraph + optional pull-quote + a CTA pair. Replaces a markdown +
// cta_pair combo when the closing wants editorial typographic weight.
// ---------------------------------------------------------------------------

export const ClosingStatementBlockSchema = z.object({
  eyebrow: z.string().min(1).max(80),
  heading: NonEmptyString,
  leadParagraph: z.string().min(1).max(800),
  pullQuote: z.string().max(300).optional(),
  primaryCta: CtaSchema,
  secondaryCta: CtaSchema.optional(),
});

export type ClosingStatementBlockProps = z.infer<
  typeof ClosingStatementBlockSchema
>;

// ---------------------------------------------------------------------------
// stat_band — full-width 3-column stat strip with eyebrow + number +
// unit + subtext per column. Surface-1 background, hairline top/bottom,
// vertical hairline dividers between columns on desktop. Matches the
// brief in docs/stat-band-brief.md.
// ---------------------------------------------------------------------------

export const StatBandBlockSchema = z.object({
  stats: z
    .array(
      z.object({
        eyebrow: z.string().min(1).max(80),
        number: z.string().min(1).max(12),
        unit: z.string().min(1).max(40),
        subtext: z.string().min(1).max(200),
      }),
    )
    .min(2)
    .max(4),
});

export type StatBandBlockProps = z.infer<typeof StatBandBlockSchema>;

// ---------------------------------------------------------------------------
// timeline — wraps the home page Timeline component (dots on a hairline).
// ---------------------------------------------------------------------------

export const TimelineBlockSchema = z.object({
  heading: NonEmptyString,
  subtext: z.string().max(400).optional(),
  milestones: z
    .array(
      z.object({
        week: z.string().min(1).max(40),
        label: z.string().min(1).max(120),
      }),
    )
    .min(2)
    .max(8),
});

export type TimelineBlockProps = z.infer<typeof TimelineBlockSchema>;

// ---------------------------------------------------------------------------
// objection_faq — wraps the home page ObjectionFaq (<details>/<summary>).
// ---------------------------------------------------------------------------

export const ObjectionFaqBlockSchema = z.object({
  heading: NonEmptyString,
  subtext: z.string().max(400).optional(),
  items: z
    .array(
      z.object({
        question: NonEmptyString,
        answer: z.array(z.string().min(1).max(2000)).min(1).max(8),
      }),
    )
    .min(1)
    .max(12),
});

export type ObjectionFaqBlockProps = z.infer<typeof ObjectionFaqBlockSchema>;

// ---------------------------------------------------------------------------
// quick_diagnosis — interactive three-question diagnosis block.
//
// Renders the eyebrow / heading / subtext + three single-select question
// groups + an output panel with the diagnosis sentence + two CTAs.
//
// The QUESTIONS, OPTIONS, and DIAGNOSIS LOGIC live in the adapter
// component (components/pages/blocks/quick-diagnosis-block.tsx), not in
// props — they are tightly coupled to the AI Readiness Assessment
// domain and not author-editable. Admin can tune the SURROUNDING COPY
// (eyebrow, heading, subtext, disclaimer, CTA labels/hrefs).
// ---------------------------------------------------------------------------

export const QuickDiagnosisBlockSchema = z.object({
  eyebrow: z.string().min(1).max(80),
  heading: NonEmptyString,
  subtext: z.string().max(400),
  disclaimer: z.string().max(400),
  primaryCta: CtaSchema,
  secondaryCta: CtaSchema,
});

export type QuickDiagnosisBlockProps = z.infer<typeof QuickDiagnosisBlockSchema>;

// ---------------------------------------------------------------------------
// Union type for the discriminator-style usage in BlocksRenderer.
// ---------------------------------------------------------------------------

export type AnyBlockProps =
  | { blockType: "hero"; props: HeroBlockProps }
  | { blockType: "proof_grid"; props: ProofGridBlockProps }
  | { blockType: "service_grid"; props: ServiceGridBlockProps }
  | { blockType: "cta_pair"; props: CtaPairBlockProps }
  | { blockType: "markdown"; props: MarkdownBlockProps }
  | { blockType: "quick_diagnosis"; props: QuickDiagnosisBlockProps }
  | { blockType: "editorial_essay"; props: EditorialEssayBlockProps }
  | { blockType: "process_steps"; props: ProcessStepsBlockProps }
  | { blockType: "editorial_faq"; props: EditorialFaqBlockProps }
  | { blockType: "closing_statement"; props: ClosingStatementBlockProps };
