// How I Work — numbered items in a 2x2 grid on desktop, single column
// on mobile. Per the May 2026 /about rewrite: "no cards, no borders.
// Just numbered items with a title and one-line description. The grid
// does the visual separation."
//
// Each item is a small typographic block: a lavender NN counter at the
// top, a card-title headline, then a body line in ink-muted. The grid
// gap carries the negative space.

export type WayOfWorkingStep = {
  headline: string;
  body: string;
};

export type WayOfWorkingStepsProps = {
  steps: WayOfWorkingStep[];
};

export function WayOfWorkingSteps({ steps }: WayOfWorkingStepsProps) {
  return (
    <ol className="grid gap-10 md:grid-cols-2 md:gap-x-12 md:gap-y-12">
      {steps.map((step, i) => {
        const n = String(i + 1).padStart(2, "0");
        return (
          <li key={step.headline} className="flex flex-col gap-3">
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
