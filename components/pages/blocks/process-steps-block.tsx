import type { ProcessStepsBlockProps } from "../../../lib/pages/blocks/schemas";

// Process steps — full-width vertical bands. No cards. Each step is
// its own architectural moment.
//
// Per-band layout:
//   ─────────────────────────────────────────────────────  (hairline)
//   [HUGE NUMERAL]    [LABEL eyebrow lavender]
//                     [Body text in a generous column]
//   ─────────────────────────────────────────────────────  (hairline)
//
// The numerals dominate. They're the visual through-line — readers
// scroll past four enormous numbers in sequence and understand the
// progression without reading. Body text is supporting evidence.

export function ProcessStepsBlock(props: ProcessStepsBlockProps) {
  return (
    <section className="bg-canvas py-24 md:py-32">
      <div className="mx-auto max-w-[1280px] px-6 md:px-12">
        <h2 className="max-w-[1000px] text-display-lg text-ink md:text-display-xl">
          {props.heading}
        </h2>
        {props.intro ? (
          <p className="mt-8 max-w-[640px] text-body-lg text-ink-subtle">
            {props.intro}
          </p>
        ) : null}

        <ol className="mt-24 border-t border-hairline">
          {props.steps.map((step, idx) => {
            const numeral = String(idx + 1).padStart(2, "0");
            return (
              <li
                key={idx}
                className="grid grid-cols-1 gap-x-12 gap-y-6 border-b border-hairline py-16 md:grid-cols-[1fr_2fr] md:py-20 lg:gap-x-24"
              >
                <span
                  className="font-mono leading-none text-ink-tertiary"
                  style={{
                    fontSize: "clamp(96px, 14vw, 200px)",
                    fontWeight: 500,
                    letterSpacing: "-0.04em",
                  }}
                >
                  {numeral}
                </span>
                <div>
                  <p className="text-eyebrow uppercase tracking-[0.2em] text-primary">
                    {step.label}
                  </p>
                  <p className="mt-6 max-w-[640px] text-headline leading-[1.35] text-ink">
                    {step.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
