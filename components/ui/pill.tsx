// Small uppercase label with accent border — matches the home page's
// hero pill ("AI Transformation Practice"). Used to flag section
// context above an H1 or to mark a status/category. Server component;
// no interactivity.

import type { ReactNode } from "react";

export interface PillProps {
  children: ReactNode;
  className?: string;
}

export function Pill({ children, className = "" }: PillProps) {
  return (
    <span
      className={`inline-block rounded-full border border-accent px-3 py-1 text-[13px] font-medium uppercase tracking-[0.08em] text-accent ${className}`}
    >
      {children}
    </span>
  );
}
