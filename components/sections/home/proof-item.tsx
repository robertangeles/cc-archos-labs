// One anonymised proof point, rendered inside the Solution+Proof section.
// Three of these stack horizontally on desktop, vertically on mobile.
//
// Evidence-dossier treatment: elevated card surface (bg-surface-1), full
// hairline border, rounded corners, generous padding. A small lavender
// stroke sits in the top-left corner — brand mark + "evidence stamp" —
// that extends on hover. Body text is promoted to text-body-lg in full
// ink so the proof reads as the protagonist of the card, not its footer.
// Hover state darkens the border and extends the stroke; the only
// non-CTA element on the page that animates on interaction.

import type { ReactNode } from "react";

type ProofItemProps = {
  label: string;
  outcome: ReactNode;
};

export function ProofItem({ label, outcome }: ProofItemProps) {
  return (
    <article className="group relative flex h-full flex-col gap-5 rounded-lg border border-hairline bg-surface-1 p-8 transition-colors duration-200 hover:border-hairline-strong">
      <span
        aria-hidden
        className="pointer-events-none absolute left-8 top-0 h-px w-12 bg-primary transition-all duration-300 group-hover:w-24"
      />
      <span className="text-eyebrow uppercase text-ink-tertiary">{label}</span>
      <p className="text-body-lg text-ink">{outcome}</p>
    </article>
  );
}
