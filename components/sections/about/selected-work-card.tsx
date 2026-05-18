// Selected Work card — anonymised practitioner win.
//
// Visually mirrors the home page <ProofItem>: surface-1 card with a
// top-left lavender stroke (48px → 96px on hover), full-ink body. Stroke
// direction is the convention: top-left = evidence (something already
// happened). Same vocabulary as home — the page reads consistently across
// /about and /, which matters because both pages reference the same wins.
//
// Optional `href` slot is reserved for a future case-study page. Leave
// undefined until the case-study slug exists; once it does, the card
// becomes a Link without changing the visual treatment.

import Link from "next/link";

export type SelectedWorkCardProps = {
  label: string;
  outcome: string;
  /** Optional. When set, the entire card becomes a Link to the case
   *  study. Reserved for future `/case-studies/[slug]` pages. */
  href?: string;
};

const CARD_CLASS =
  "group relative flex h-full flex-col gap-5 rounded-lg border border-hairline bg-surface-1 p-8 transition-colors duration-200 hover:border-hairline-strong";

const STROKE = (
  <span
    aria-hidden
    className="pointer-events-none absolute left-8 top-0 h-px w-12 bg-primary transition-all duration-300 group-hover:w-24"
  />
);

export function SelectedWorkCard({
  label,
  outcome,
  href,
}: SelectedWorkCardProps) {
  if (href) {
    return (
      <Link
        href={href}
        className={`${CARD_CLASS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas`}
      >
        {STROKE}
        <span className="text-eyebrow uppercase text-ink-tertiary">{label}</span>
        <p className="text-body-lg text-ink">{outcome}</p>
      </Link>
    );
  }
  return (
    <article className={CARD_CLASS}>
      {STROKE}
      <span className="text-eyebrow uppercase text-ink-tertiary">{label}</span>
      <p className="text-body-lg text-ink">{outcome}</p>
    </article>
  );
}
