// Numbered section heading for the /book progressive-reveal flow
// (D15 — implicit progress via numbered headings only, no separate
// progress bar). Renders as 24px semibold matching plan §17.3.
// Server component; pure presentation.

import type { ReactNode } from "react";

export interface StepHeadingProps {
  number: number;
  children: ReactNode;
  className?: string;
}

export function StepHeading({
  number,
  children,
  className = "",
}: StepHeadingProps) {
  return (
    <h2
      className={`text-[24px] font-semibold leading-[1.25] tracking-[-0.01em] text-ink ${className}`}
    >
      <span className="mr-3 text-ink-subtle tabular-nums">{number}.</span>
      {children}
    </h2>
  );
}
