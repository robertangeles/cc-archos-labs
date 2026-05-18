import { Section } from "../../sections/home/section";
import { ProofItem } from "../../sections/home/proof-item";
import type { ProofGridBlockProps } from "../../../lib/pages/blocks/schemas";

// Proof grid block — section heading + N proof items in a responsive
// grid (stacks on mobile, 3-up on desktop with auto-fit so any item
// count between 1 and 6 lays out gracefully).

export function ProofGridBlock(props: ProofGridBlockProps) {
  return (
    <Section bg="surface-1" pad="relaxed">
      {props.eyebrow ? (
        <p className="uppercase text-eyebrow text-ink-subtle">
          {props.eyebrow}
        </p>
      ) : null}
      <h2 className="mt-4 text-display-md text-ink md:text-display-lg">
        {props.heading}
      </h2>
      <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {props.items.map((item, idx) => (
          <ProofItem key={idx} label={item.label} outcome={item.outcome} />
        ))}
      </div>
    </Section>
  );
}
