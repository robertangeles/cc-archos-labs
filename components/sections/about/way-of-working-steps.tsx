// How I Work — numbered items in a 2x2 grid on desktop, single column
// on mobile.
//
// First pass shipped these as borderless typographic blocks (per the
// May 2026 brief). Review feedback: they read as unstyled placeholder
// text on a dark background. Restored to a card treatment — each item
// lifts one step above the section background to surface-2, hairline
// border, generous padding, lavender mono counter on top, card-title
// headline, ink-muted body.

export type WayOfWorkingStep = {
  headline: string;
  body: string;
};

export type WayOfWorkingStepsProps = {
  steps: WayOfWorkingStep[];
};

export function WayOfWorkingSteps({ steps }: WayOfWorkingStepsProps) {
  return (
    <ol className="grid gap-6 md:grid-cols-2 md:gap-8">
      {steps.map((step, i) => {
        const n = String(i + 1).padStart(2, "0");
        return (
          <li
            key={step.headline}
            className="flex h-full flex-col gap-4 rounded-lg border border-hairline bg-surface-2 p-8 transition-colors duration-200 hover:border-hairline-strong"
          >
            <p className="font-mono text-caption uppercase text-primary">
              {n}
            </p>
            <h3 className="text-card-title text-ink">{step.headline}</h3>
            <p className="text-body-lg text-ink-muted">{step.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
