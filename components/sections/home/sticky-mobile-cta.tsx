"use client";

// Sticky bottom-of-screen CTA bar, mobile only (≤ 768px). Hides itself
// once the final CTA section enters the viewport — avoids stacking the
// floating CTA on top of the in-flow CTA at the bottom of the page.
//
// Uses IntersectionObserver on a selector passed by the caller (defaults
// to the Final CTA section's id). prefers-reduced-motion is honoured by
// dropping the slide-in transition; the bar still appears/disappears,
// just without animation.
//
// Per CLAUDE.md mobile-first mandate: an exec on a phone in a Tuesday
// standup should be able to reach both CTAs in 2 taps from any scroll
// position.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { track } from "../../../lib/analytics";

type StickyCta = {
  label: string;
  href: string;
};

type StickyMobileCtaProps = {
  primary: StickyCta;
  secondary: StickyCta;
  /** CSS selector for the element that, when scrolled into view, hides
   *  the sticky bar. Defaults to `#final-cta`. */
  hideWhenSelector?: string;
};

export function StickyMobileCta({
  primary,
  secondary,
  hideWhenSelector = "#final-cta",
}: StickyMobileCtaProps) {
  const [visible, setVisible] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const target = document.querySelector(hideWhenSelector);
    if (!target) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Hide when the Final CTA enters the viewport; show again when
          // it leaves (e.g. the user scrolls back up).
          setVisible(!entry.isIntersecting);
        }
      },
      { threshold: 0.15 },
    );

    observerRef.current.observe(target);
    return () => observerRef.current?.disconnect();
  }, [hideWhenSelector]);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface-1/95 backdrop-blur md:hidden ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-full opacity-0"
      } transition-transform transition-opacity duration-200 motion-reduce:transition-none`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch gap-2 px-4 py-3">
        <Link
          href={primary.href}
          onClick={() =>
            track("cta.assessment.clicked", { position: "sticky-mobile" })
          }
          className="flex flex-1 items-center justify-center rounded-md bg-primary px-4 py-3 text-button text-white transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {primary.label}
        </Link>
        <Link
          href={secondary.href}
          onClick={() =>
            track("cta.bookcall.clicked", { position: "sticky-mobile" })
          }
          className="flex flex-1 items-center justify-center rounded-md border border-hairline-strong px-4 py-3 text-button text-ink transition-colors duration-150 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {secondary.label}
        </Link>
      </div>
    </div>
  );
}
