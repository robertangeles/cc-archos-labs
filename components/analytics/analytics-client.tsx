"use client";

// Single client component that handles non-click analytics for the home
// page: page.viewed (fires once on mount) and scroll.depth (fires once at
// each of 25/50/75/100 % thresholds as the user reaches them).
//
// Click events are tracked directly inside the components that own each
// CTA (CtaPair, StickyMobileCta, AnchorNav) so the position metadata stays
// co-located with the click. This component only handles the page-level
// signals that don't belong on any single element.
//
// Renders null. Mount it once near the top of app/page.tsx so the
// page-view event fires as soon as the document is interactive.

import { useEffect, useRef } from "react";
import { track, type AnalyticsProps } from "../../lib/analytics";

type Props = {
  route: string;
};

const DEPTH_THRESHOLDS = [25, 50, 75, 100] as const;

export function AnalyticsClient({ route }: Props) {
  // Ref-tracked so re-renders don't double-fire depth events.
  const firedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    track("page.viewed", { route } satisfies AnalyticsProps);

    function onScroll() {
      const doc = document.documentElement;
      const viewport = window.innerHeight;
      const scrollable = doc.scrollHeight - viewport;
      if (scrollable <= 0) return;

      const pct = Math.min(
        100,
        Math.round((window.scrollY / scrollable) * 100),
      );

      for (const threshold of DEPTH_THRESHOLDS) {
        if (pct >= threshold && !firedRef.current.has(threshold)) {
          firedRef.current.add(threshold);
          track("scroll.depth", { pct: threshold });
        }
      }
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [route]);

  return null;
}
