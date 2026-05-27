// One anonymised proof point, rendered inside the home page Proof section.
// Three of these stack horizontally on desktop, vertically on mobile.
//
// Two render modes:
//   1. Modern: eyebrow + title + body + stat (footer). Used by the May
//      2026 SMB rewrite — eyebrow stays small, title leads the card, body
//      explains, stat anchors the bottom with a number + qualifier.
//   2. Legacy: label + outcome. Single eyebrow + single body. Preserved
//      so the Pages CMS proof-grid block keeps compiling unchanged.
//
// Surface treatment is identical across both: surface-1 background with
// a hairline border, lavender stroke top-left that extends on hover,
// border darkens on hover. The only animated non-CTA element on the page.

import type { ReactNode } from "react";

type ProofItemProps = {
  /** Modern eyebrow (e.g. "Legacy systems", "Sovereign AI"). */
  eyebrow?: string;
  /** Modern title — the headline claim. */
  title?: ReactNode;
  /** Modern body — explains the claim. */
  body?: ReactNode;
  /** Modern stat — number + qualifier (e.g. "3 months  ·  estimate was 6–9"). */
  stat?: string;
  /** Legacy eyebrow + body collapsed into two fields. */
  label?: string;
  outcome?: ReactNode;
};

export function ProofItem({
  eyebrow,
  title,
  body,
  stat,
  label,
  outcome,
}: ProofItemProps) {
  const modern = title || body || stat || eyebrow;
  return (
    <article className="group relative flex h-full flex-col gap-5 rounded-lg border border-hairline bg-surface-1 p-8 transition-colors duration-200 hover:border-hairline-strong hover:bg-surface-2">
      <span
        aria-hidden
        className="pointer-events-none absolute left-8 top-0 h-px w-12 bg-primary transition-all duration-300 group-hover:w-24"
      />
      {modern ? (
        <>
          {eyebrow ? (
            <span className="text-eyebrow uppercase text-ink-subtle">
              {eyebrow}
            </span>
          ) : null}
          {title ? (
            <h3 className="text-card-title text-ink">{title}</h3>
          ) : null}
          {body ? <p className="text-body text-ink-muted">{body}</p> : null}
          {stat ? (
            <div className="mt-auto border-t border-hairline pt-5 text-body-sm text-ink-subtle">
              {stat}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {label ? (
            <span className="text-eyebrow uppercase text-ink-tertiary">
              {label}
            </span>
          ) : null}
          {outcome ? (
            <p className="text-body-lg text-ink">{outcome}</p>
          ) : null}
        </>
      )}
    </article>
  );
}
