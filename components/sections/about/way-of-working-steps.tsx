// Way of Working — sequential numbered steps with prose.
//
// Vertical stack on both mobile and desktop (the steps are sequential,
// not parallel — a 2-col layout would imply equivalence). Numbered with
// the same `NN / TT` mono counter pattern as the home page ServiceCard.

export type WayOfWorkingStep = {
  headline: string;
  body: string;
};

export type WayOfWorkingStepsProps = {
  steps: WayOfWorkingStep[];
};

export function WayOfWorkingSteps({ steps }: WayOfWorkingStepsProps) {
  const total = String(steps.length).padStart(2, "0");
  return (
    <ol className="flex flex-col gap-10">
      {steps.map((step, i) => {
        const n = String(i + 1).padStart(2, "0");
        return (
          <li
            key={step.headline}
            className="grid gap-4 md:grid-cols-[120px_1fr] md:gap-10"
          >
            <p className="text-mono uppercase text-ink-tertiary">
              {n} / {total}
            </p>
            <div className="flex flex-col gap-3">
              <h3 className="text-card-title text-ink">{step.headline}</h3>
              <p className="text-body-lg text-ink-subtle">
                {step.body}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
