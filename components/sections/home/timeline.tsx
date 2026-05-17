// 90-day timeline visualisation rendered between Solution+Proof and Services.
// Typography-led — no infographic clutter. A horizontal milestone bar on
// desktop; vertical stack on mobile.
//
// Big Four sell multi-month timelines; Archos Labs sells weeks. The visual
// proof of speed claim that the practitioner narrative makes everywhere else
// on the page.

type Milestone = {
  week: string;
  label: string;
};

type TimelineProps = {
  milestones: Milestone[];
};

export function Timeline({ milestones }: TimelineProps) {
  return (
    <ol className="mt-12 grid gap-6 md:grid-cols-5 md:gap-4">
      {milestones.map((m, i) => (
        <li
          key={m.week}
          className="relative flex flex-col gap-2 border-t border-hairline pt-6 md:pt-8"
        >
          <span
            aria-hidden
            className="absolute -top-[5px] left-0 h-[9px] w-[9px] rounded-full bg-primary"
          />
          <span className="text-eyebrow uppercase text-primary">{m.week}</span>
          <span className="text-body text-ink">{m.label}</span>
          {i < milestones.length - 1 ? (
            <span
              aria-hidden
              className="hidden md:absolute md:-top-px md:left-[9px] md:right-0 md:block md:h-px md:bg-hairline"
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
