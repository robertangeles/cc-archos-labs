// Hero section — eyebrow + headline + subhead + primary CTA pair, with
// an optional desktop-only AnchorNav slot beneath the CTAs.
//
// The lavender radial gradient + the lavender accent on the verb "fail"
// are the locked treatment from the original home page (per DESIGN.md
// — primary lavender reserved for CTAs, focus, link emphasis, and the
// brand mark; the hero verb accent counts as brand mark territory).
//
// Headline is typed as ReactNode so the page composition can inject the
// lavender <span> around "fail" without this component knowing the copy.

import type { ReactNode } from "react";
import { CtaPair, type CtaPairProps } from "./cta-pair";
import { AnchorNav, type AnchorNavProps } from "./anchor-nav";

// Primary lavender (#5e6ad2 → rgb 94, 106, 210) at 12% opacity. Re-derive
// from --color-primary if that token ever rotates.
const HERO_GRADIENT =
  "radial-gradient(ellipse 80% 60% at 50% 25%, rgba(94, 106, 210, 0.12) 0%, transparent 70%)";

export type HeroProps = {
  eyebrow: string;
  headline: ReactNode;
  subhead: ReactNode;
  cta: CtaPairProps;
  anchorNav?: AnchorNavProps;
};

export function Hero({ eyebrow, headline, subhead, cta, anchorNav }: HeroProps) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ backgroundImage: HERO_GRADIENT }}
      />
      <div className="mx-auto flex max-w-[1080px] flex-col items-center px-6 pt-32 pb-20 text-center md:px-12">
        <span className="inline-block rounded-full border border-hairline-strong px-3 py-1 uppercase text-eyebrow text-ink-subtle">
          {eyebrow}
        </span>
        <h1 className="mt-8 text-display-md text-ink md:text-display-xl">
          {headline}
        </h1>
        <p className="mt-6 max-w-[640px] text-body-lg text-ink-subtle">
          {subhead}
        </p>
        <div className="mt-12">
          <CtaPair {...cta} />
        </div>
        {anchorNav ? (
          <div className="mt-10 hidden lg:block">
            <AnchorNav {...anchorNav} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
