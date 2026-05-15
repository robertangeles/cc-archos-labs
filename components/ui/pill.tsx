// Small uppercase taxonomy pill — used as a section eyebrow above an H1
// or to mark a status/category. Per DESIGN.md the eyebrow is a
// taxonomy marker, NOT a brand element — so the pill uses hairline
// border + ink-subtle text rather than the lavender primary that's
// reserved for CTAs, focus rings, link emphasis, and the brand mark.

import type { ReactNode } from "react";

export interface PillProps {
  children: ReactNode;
  className?: string;
}

export function Pill({ children, className = "" }: PillProps) {
  return (
    <span
      className={`inline-block rounded-full border border-hairline-strong px-3 py-1 uppercase text-eyebrow text-ink-subtle ${className}`}
    >
      {children}
    </span>
  );
}
