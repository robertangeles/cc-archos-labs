// Timeline visualisation rendered between sections that need a five-step
// "from A to Z" beat. Typography-led — no infographic clutter. Horizontal
// milestone bar on desktop; vertical stack on mobile.
//
// Big Four sell multi-month timelines; Archos Labs sells weeks. The visual
// proof of the speed claim that the practitioner narrative makes elsewhere.
//
// Per-step `description` is optional. When supplied, the step renders the
// description inline below the label — used by /consulting to remove the
// "I don't know what happens after I click" fear without resorting to a
// second redundant grid row underneath the timeline.

type Milestone = {
  week: string;
  label: string;
  description?: string;
};

type TimelineProps = {
  milestones: Milestone[];
};

export function Timeline({ milestones }: TimelineProps) {
  return (
    <ol className="mt-12 grid gap-8 md:grid-cols-5 md:gap-6">
      {milestones.map((m, i) => (
        <li
          key={m.week}
          className="relative flex flex-col gap-3 border-t border-hairline pt-6 md:pt-8"
        >
          <span
            aria-hidden
            className="absolute -top-[5px] left-0 h-[9px] w-[9px] rounded-full bg-primary"
          />
          <span className="text-eyebrow uppercase text-primary">{m.week}</span>
          <span className="text-body-lg text-ink md:text-card-title">
            {m.label}
          </span>
          {m.description ? (
            <span className="text-body text-ink-muted">{m.description}</span>
          ) : null}
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
