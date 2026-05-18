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
// Union type for the discriminator-style usage in BlocksRenderer.
// ---------------------------------------------------------------------------

export type AnyBlockProps =
  | { blockType: "hero"; props: HeroBlockProps }
  | { blockType: "proof_grid"; props: ProofGridBlockProps }
  | { blockType: "service_grid"; props: ServiceGridBlockProps }
  | { blockType: "cta_pair"; props: CtaPairBlockProps }
  | { blockType: "markdown"; props: MarkdownBlockProps };
