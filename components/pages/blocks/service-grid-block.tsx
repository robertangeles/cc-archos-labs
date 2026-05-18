import { Section } from "../../sections/home/section";
import { ServiceCard } from "../../sections/home/service-card";
import type { ServiceGridBlockProps } from "../../../lib/pages/blocks/schemas";

// Service grid block — section heading + N service cards in a 2-up
// (or single-column) grid. `index`/`total` are derived here so authors
// don't need to keep them in sync manually.

export function ServiceGridBlock(props: ServiceGridBlockProps) {
  const total = props.services.length;
  return (
    <Section bg="canvas" pad="relaxed">
      {props.eyebrow ? (
        <p className="uppercase text-eyebrow text-ink-subtle">
          {props.eyebrow}
        </p>
      ) : null}
      <h2 className="mt-4 text-display-md text-ink md:text-display-lg">
        {props.heading}
      </h2>
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {props.services.map((service, idx) => (
          <ServiceCard
            key={idx}
            name={service.name}
            body={service.body}
            index={idx + 1}
            total={total}
            deliverable={service.deliverable}
          />
        ))}
      </div>
    </Section>
  );
}
