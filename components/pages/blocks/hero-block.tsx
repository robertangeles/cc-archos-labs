import { Hero } from "../../sections/home/hero";
import type { HeroBlockProps } from "../../../lib/pages/blocks/schemas";

// Hero block adapter. Maps the JSON-stored block props to the Hero
// section component's prop shape.
//
// Note: Hero's `headline` and `subhead` accept ReactNode so the home
// page can inject lavender accents. The block stores them as plain
// strings. Phase 2 trades inline accent capability for storability;
// authors can still render emphasised text in the markdown block above
// or below the hero. A future enhancement could parse a simple syntax
// like `{accent}fail{/accent}` into ReactNode — out of scope here.

export function HeroBlock(props: HeroBlockProps) {
  return (
    <Hero
      eyebrow={props.eyebrow}
      headline={props.headline}
      subhead={props.subhead}
      cta={
        props.primaryCta
          ? {
              primary: {
                label: props.primaryCta.label,
                href: props.primaryCta.href,
                microcopy: props.primaryCta.microcopy,
              },
              secondary: props.secondaryCta
                ? {
                    label: props.secondaryCta.label,
                    href: props.secondaryCta.href,
                    microcopy: props.secondaryCta.microcopy,
                  }
                : undefined,
              position: "hero",
            }
          : undefined
      }
    />
  );
}
