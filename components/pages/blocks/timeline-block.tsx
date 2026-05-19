import { Section } from "../../sections/home/section";
import { Timeline } from "../../sections/home/timeline";

// Timeline block — thin adapter around the home page's Timeline
// component. Reuses the exact visual pattern (lavender dots on a
// hairline, eyebrow week labels) so composed pages match the home
// page's design language with zero divergence.

export interface TimelineBlockProps {
  heading: string;
  subtext?: string;
  milestones: Array<{ week: string; label: string }>;
}

export function TimelineBlock(props: TimelineBlockProps) {
  return (
    <Section bg="surface-1">
      <h2 className="text-display-md text-ink">{props.heading}</h2>
      {props.subtext ? (
        <p className="mt-5 max-w-[640px] text-body-lg text-ink-subtle">
          {props.subtext}
        </p>
      ) : null}
      <Timeline milestones={props.milestones} />
    </Section>
  );
}
