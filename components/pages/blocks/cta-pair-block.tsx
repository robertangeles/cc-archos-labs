import { Section } from "../../sections/home/section";
import { CtaPair } from "../../sections/home/cta-pair";
import type { CtaPairBlockProps } from "../../../lib/pages/blocks/schemas";

// Standalone CTA band — used as a closing block or mid-page break.
// Wraps the existing CtaPair component inside a "bordered" Section so
// it reads as its own moment on the page.

export function CtaPairBlock(props: CtaPairBlockProps) {
  return (
    <Section bg="bordered" pad="relaxed" centered>
      <CtaPair
        primary={props.primary}
        secondary={props.secondary}
        position={props.position}
        align={props.align}
      />
    </Section>
  );
}
