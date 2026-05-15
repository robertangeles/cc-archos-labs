"use client";

// Time-slot pill (plan §17.7). Full-width within the slot list column,
// rounded-md (not pill-shape), tabular-nums for clean column alignment,
// left-aligned. Three visible states:
//
//   default   — surface bg, rule border, fg text
//   hover     — same but border flips to accent (matches the home page's
//               service-card hover treatment)
//   selected  — accent fill, white text, no border (the moment of
//               commitment)
//
// No icons inside the pill (per §17.7) — time text alone.

import { forwardRef, type ButtonHTMLAttributes } from "react";

const baseClass =
  "w-full rounded-md px-4 py-3 text-left text-sm font-medium tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50 disabled:cursor-not-allowed";

const stateClass = {
  default: "bg-surface-1 border border-hairline text-ink hover:border-primary",
  selected: "bg-primary text-white border border-primary",
} as const;

export interface SlotPillProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  selected?: boolean;
  // Human-readable time, e.g. "2:00 PM". Caller formats via Intl.
  time: string;
}

export const SlotPill = forwardRef<HTMLButtonElement, SlotPillProps>(
  function SlotPill(
    { selected = false, time, className = "", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={selected}
        className={`${baseClass} ${selected ? stateClass.selected : stateClass.default} ${className}`}
        {...props}
      >
        {time}
      </button>
    );
  },
);
