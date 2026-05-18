// One service card inside the Services section. Four of these in a 2x2
// grid on desktop, stacked on mobile. No prices per CLAUDE.md.
//
// Practitioner-Manifest treatment: each card opens with a metadata row
// (numbered counter on the left, deliverable tag on the right) over a
// hairline divider, then the title in text-headline, then the body in
// text-body-lg ink. A small lavender stroke at the bottom-left mirrors
// the proof card's top-left stroke — visual conversation between the
// two card grids on the page (proofs open at top, services at bottom).
// Hover: card lifts a half-step (surface-1 -> surface-2), border darkens,
// stroke extends.

type ServiceCardProps = {
  name: string;
  body: string;
  index: number;
  total: number;
  deliverable: string;
};

export function ServiceCard({
  name,
  body,
  index,
  total,
  deliverable,
}: ServiceCardProps) {
  const indexLabel = String(index).padStart(2, "0");
  const totalLabel = String(total).padStart(2, "0");
  return (
    <article className="group relative flex h-full flex-col gap-6 overflow-hidden rounded-lg border border-hairline bg-surface-1 p-10 transition-colors duration-200 hover:border-hairline-strong hover:bg-surface-2">
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-caption text-ink-tertiary">
          {indexLabel} / {totalLabel}
        </span>
        <span className="rounded-full border border-hairline px-3 py-1 text-eyebrow uppercase text-ink-subtle">
          {deliverable}
        </span>
      </div>
      <div aria-hidden className="h-px bg-hairline" />
      <h3 className="text-headline text-ink">{name}</h3>
      <p className="text-body-lg text-ink">{body}</p>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-10 h-px w-12 bg-primary transition-all duration-300 group-hover:w-24"
      />
    </article>
  );
}
