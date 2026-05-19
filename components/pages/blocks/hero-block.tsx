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

// Composed CMS pages commit to a left-aligned reading axis end-to-end.
// Every section below the hero is left-aligned; a centred hero on top
// reads as marketing rather than authoritative. The home page imports
// Hero directly and keeps its centred treatment — only the block adapter
// switches alignment, so this is scoped to CMS-composed pages.

export function HeroBlock(props: HeroBlockProps) {
  return (
    <Hero
      align="left"
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
