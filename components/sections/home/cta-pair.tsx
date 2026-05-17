"use client";

// Primary + optional secondary CTA pair used by the home page in three
// positions: hero, assessment-block (assessment-only), final.
//
// "use client" so we can wire onClick handlers that fire analytics events
// before the navigation completes. Uses next/link for client-side navigation
// (same prefetch + soft-nav behaviour as the rest of the app).
//
// Visual hierarchy: primary (Take the assessment) is lavender-filled;
// secondary (Book a call) is outlined. Pre-CTA microcopy renders directly
// below each button per the locked decision (E6).

import Link from "next/link";
import { track } from "../../../lib/analytics";

type Cta = {
  label: string;
  href: string;
  microcopy?: string;
};

type Position = "hero" | "assessment-block" | "final" | "sticky-mobile";

export type CtaPairProps = {
  primary: Cta;
  /** Optional. When omitted, the pair renders only the primary CTA
   *  (used by the Assessment Block per the locked plan). */
  secondary?: Cta;
  position: Position;
  /** Visual alignment when stacked. Defaults to `center`. */
  align?: "left" | "center";
};

const primaryButtonClass =
  "inline-flex items-center justify-center rounded-md bg-primary px-7 py-3 text-button text-white transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-md border border-hairline-strong px-7 py-3 text-button text-ink transition-colors duration-150 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

function trackPrimary(position: Position) {
  // The primary CTA is always "Take the assessment" in our copy. Keep the
  // event name semantic (cta.assessment.clicked) rather than coupled to
  // label text so we can rename the button without breaking analytics.
  track("cta.assessment.clicked", { position });
}

function trackSecondary(position: Position) {
  track("cta.bookcall.clicked", { position });
}

export function CtaPair({
  primary,
  secondary,
  position,
  align = "center",
}: CtaPairProps) {
  const alignmentClass =
    align === "center"
      ? "items-center justify-center"
      : "items-start justify-start";

  return (
    <div
      className={`flex flex-col gap-6 sm:flex-row sm:gap-4 ${alignmentClass}`}
    >
      <div
        className={`flex flex-col gap-2 ${align === "center" ? "items-center" : "items-start"}`}
      >
        <Link
          href={primary.href}
          className={primaryButtonClass}
          onClick={() => trackPrimary(position)}
          data-cta="primary"
          data-position={position}
        >
          {primary.label}
        </Link>
        {primary.microcopy ? (
          <span className="text-caption text-ink-tertiary">
            {primary.microcopy}
          </span>
        ) : null}
      </div>

      {secondary ? (
        <div
          className={`flex flex-col gap-2 ${align === "center" ? "items-center" : "items-start"}`}
        >
          <Link
            href={secondary.href}
            className={secondaryButtonClass}
            onClick={() => trackSecondary(position)}
            data-cta="secondary"
            data-position={position}
          >
            {secondary.label}
          </Link>
          {secondary.microcopy ? (
            <span className="text-caption text-ink-tertiary">
              {secondary.microcopy}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
