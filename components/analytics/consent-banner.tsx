"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONSENT_KEY, applyConsent } from "./consent";

// Two-button cookie banner. Shows once (until a choice is stored), applies the
// choice to GA4 + Meta live, and persists it. Region-scoped consent defaults
// are already set by the inline consent script in the layout, so this banner is
// the visitor's override — Accept grants everywhere, Reject denies everywhere.
export function ConsentBanner({ enabled }: { enabled?: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(CONSENT_KEY);
    } catch {
      // localStorage blocked — show the banner rather than assume a choice.
    }
    // Mount-time localStorage read is client-only (undefined during SSR), so a
    // mount effect is the correct place to decide visibility.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored !== "granted" && stored !== "denied") setVisible(true);
  }, [enabled]);

  if (!enabled || !visible) return null;

  function choose(granted: boolean) {
    applyConsent(granted);
    setVisible(false);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:p-6">
      <div
        role="region"
        aria-label="Cookie consent"
        className="pointer-events-auto flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-hairline bg-surface-2 p-4 shadow-lg sm:flex-row sm:items-center sm:gap-4 sm:p-5"
      >
        <p className="flex-1 text-sm leading-relaxed text-ink-muted">
          We use cookies for analytics and to measure our advertising. You can
          accept or reject non-essential cookies — see our{" "}
          <Link
            href="/privacy"
            className="text-ink underline underline-offset-2 hover:text-primary-hover"
          >
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose(false)}
            className="flex-1 rounded-lg border border-hairline-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-3 sm:flex-none"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => choose(true)}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover sm:flex-none"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
