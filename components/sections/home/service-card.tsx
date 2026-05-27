// One service card inside the Services section. Three of these in a 3-up
// grid on desktop, stacked on mobile. No prices per CLAUDE.md.
//
// The deliverable string renders as the top eyebrow. When `index` + `total`
// are supplied, a mono counter sits beside it (the Pages CMS service-grid
// uses this; the home page does not). When `bestFor` is supplied, a
// "Best for: …" footer is rendered below a hairline divider — the home
// page's new SMB shape.
//
// When `cta` is supplied, the card lifts to surface-2 (per DESIGN.md's
// `pricing-card-featured` treatment) and renders a lavender CTA link below
// the body so this card reads as the primary action of the section. The
// home page's AI Readiness card uses this — it's the only service the
// visitor can self-serve right now, so it earns the visual weight.
//
// Hover: surface lifts one more step, border darkens, lavender stroke at
// the bottom-left extends.

import Link from "next/link";

type ServiceCardProps = {
  name: string;
  body: string;
  deliverable: string;
  /** Optional 1-based index in the parent grid. Renders an NN / TT mono
   *  counter at the top-left when supplied alongside `total`. */
  index?: number;
  /** Total cards in the parent grid (required when `index` is given). */
  total?: number;
  /** Optional footer line — "Best for: …". Renders below a hairline divider. */
  bestFor?: string;
  /** Optional in-card CTA. When present, the card uses the "featured"
   *  surface treatment so it visually leads its grid neighbours. */
  cta?: { label: string; href: string };
};

export function ServiceCard({
  name,
  body,
  index,
  total,
  deliverable,
  bestFor,
  cta,
}: ServiceCardProps) {
  const showCounter = typeof index === "number" && typeof total === "number";
  const indexLabel = showCounter ? String(index).padStart(2, "0") : "";
  const totalLabel = showCounter ? String(total).padStart(2, "0") : "";
  const featured = Boolean(cta);
  const surfaceClass = featured
    ? "border-hairline-strong bg-surface-2 hover:bg-surface-3"
    : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2";
  return (
    <article
      className={`group relative flex h-full flex-col gap-6 overflow-hidden rounded-lg border p-8 transition-colors duration-200 ${surfaceClass}`}
    >
      <div className="flex items-center justify-between gap-4">
        <span
          className={`text-eyebrow uppercase ${featured ? "text-primary" : "text-ink-subtle"}`}
        >
          {deliverable}
        </span>
        {showCounter ? (
          <span className="font-mono text-caption text-ink-tertiary">
            {indexLabel} / {totalLabel}
          </span>
        ) : null}
      </div>
      <div aria-hidden className="h-px bg-hairline" />
      <h3 className="text-headline text-ink">{name}</h3>
      <p className="text-body text-ink-muted">{body}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="inline-flex items-center gap-2 text-button text-primary transition-colors duration-150 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {cta.label}
          <span aria-hidden>→</span>
        </Link>
      ) : null}
      {bestFor ? (
        <div className="mt-auto border-t border-hairline pt-5 text-body-sm text-ink-subtle">
          <span className="font-medium text-ink-muted">Best for: </span>
          {bestFor}
        </div>
      ) : null}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-8 h-px w-12 bg-primary transition-all duration-300 group-hover:w-24"
      />
    </article>
  );
}
