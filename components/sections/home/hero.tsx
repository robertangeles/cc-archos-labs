// Hero section — eyebrow + headline + subhead + primary CTA pair, with
// an optional desktop-only AnchorNav slot beneath the CTAs and an
// optional trust strip below that.
//
// The lavender radial gradient is a legacy treatment retained for the
// /about hero and any other surface that still opts into it. The home
// page sets `gradient="off"` (May 2026 SMB rewrite per DESIGN.md "no
// atmospheric gradients").
//
// Headline is typed as ReactNode so the page composition can inject
// emphasis spans without this component knowing the copy.

import type { ReactNode } from "react";
import { CtaPair, type CtaPairProps } from "./cta-pair";
import { AnchorNav, type AnchorNavProps } from "./anchor-nav";

// Primary lavender (#5e6ad2 → rgb 94, 106, 210) at 12% opacity. Re-derive
// from --color-primary if that token ever rotates. The gradient origin
// shifts with alignment so the lavender bloom sits behind the headline
// rather than floating in the negative space beside it.
const HERO_GRADIENT_CENTER =
  "radial-gradient(ellipse 80% 60% at 50% 25%, rgba(94, 106, 210, 0.12) 0%, transparent 70%)";
const HERO_GRADIENT_LEFT =
  "radial-gradient(ellipse 70% 55% at 22% 28%, rgba(94, 106, 210, 0.12) 0%, transparent 70%)";

export type HeroProps = {
  /** Optional eyebrow pill above the headline. Omit on pages that
   *  open with a direct statement (e.g. the May 2026 /about rewrite). */
  eyebrow?: string;
  headline: ReactNode;
  subhead: ReactNode;
  /** Optional. Omit for credibility-first pages (e.g. /about) where the
   *  bio earns the click further down the page. When omitted, the
   *  CtaPair block is not rendered. */
  cta?: CtaPairProps;
  anchorNav?: AnchorNavProps;
  /** Visual alignment. Defaults to `center` (home page treatment).
   *  Composed CMS pages pass `left` so the hero shares the authoritative
   *  left-aligned reading axis used by every section below it. */
  align?: "left" | "center";
  /** Atmospheric lavender radial. Defaults to `on` for back-compat;
   *  home page passes `off` per the May 2026 rewrite. */
  gradient?: "on" | "off";
  /** Optional trust strip rendered below the CTAs in the eyebrow style.
   *  Home page uses this for "25 years · Cross-industry delivery · …". */
  trustStrip?: ReactNode;
};

export function Hero({
  eyebrow,
  headline,
  subhead,
  cta,
  anchorNav,
  align = "center",
  gradient = "on",
  trustStrip,
}: HeroProps) {
  const isLeft = align === "left";
  return (
    <section className="relative overflow-hidden">
      {gradient === "on" ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage: isLeft
              ? HERO_GRADIENT_LEFT
              : HERO_GRADIENT_CENTER,
          }}
        />
      ) : null}
      <div
        className={`mx-auto flex max-w-[1080px] flex-col px-6 pt-32 pb-20 md:px-12 ${
          isLeft ? "items-start text-left" : "items-center text-center"
        }`}
      >
        {eyebrow ? (
          <span className="inline-block rounded-md border border-hairline-strong px-3 py-1 uppercase text-eyebrow text-ink-subtle">
            {eyebrow}
          </span>
        ) : null}
        <h1 className={`${eyebrow ? "mt-8" : ""} text-display-md text-ink md:text-display-xl`}>
          {headline}
        </h1>
        <p className="mt-6 max-w-[640px] text-body-lg text-ink-muted">
          {subhead}
        </p>
        {cta ? (
          <div className="mt-12">
            <CtaPair {...cta} align={cta.align ?? align} />
          </div>
        ) : null}
        {trustStrip ? (
          <p className="mt-10 text-eyebrow uppercase text-ink-subtle">
            {trustStrip}
          </p>
        ) : null}
        {anchorNav ? (
          <div className="mt-10 hidden lg:block">
            <AnchorNav {...anchorNav} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
