import { Section } from "../../sections/home/section";
import { ObjectionFaq } from "../../sections/home/objection-faq";

// Objection FAQ block — thin adapter around the home page's ObjectionFaq.
// Native <details>/<summary> disclosure, divided hairline rows, plus
// icon rotating to × on open. Reuses the home page's exact visual
// pattern — no divergence.

export interface ObjectionFaqBlockProps {
  heading: string;
  subtext?: string;
  items: Array<{ question: string; answer: string[] }>;
}

export function ObjectionFaqBlock(props: ObjectionFaqBlockProps) {
  return (
    <Section bg="canvas">
      <h2 className="text-display-md text-ink">{props.heading}</h2>
      {props.subtext ? (
        <p className="mt-5 max-w-[640px] text-body-lg text-ink-subtle">
          {props.subtext}
        </p>
      ) : null}
      <ObjectionFaq items={props.items} />
    </Section>
  );
}
