"use client";

// Calendar day-cell primitive (plan §17.6) — neutralises react-day-picker's
// default styling, which is the biggest AI-slop risk on the booking page.
//
// States:
//   default          — text-fg, transparent 1px border (becomes rule on hover)
//   outside-month    — muted/50, not interactive
//   past             — muted/30, strikethrough, not interactive
//   bookable         — same as default but with a hover treatment
//   selected         — bg-accent, white text, no border
//   today-unbooked   — small accent dot under the number
//   fully-booked     — muted/50 with a diagonal-stripe pattern background
//
// Used inside the slot picker's month grid. The wrapper component (built
// in Lane E) is responsible for grid layout and keyboard arrow nav.

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type DayCellState =
  | "default"
  | "outside-month"
  | "past"
  | "bookable"
  | "selected"
  | "today-unbooked"
  | "fully-booked";

const baseClass =
  "relative inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:h-11 sm:w-11";

const stateClass: Record<DayCellState, string> = {
  default: "text-fg border border-transparent",
  bookable:
    "text-fg border border-transparent hover:border-rule cursor-pointer",
  "outside-month": "text-muted/50 cursor-default",
  past: "text-muted/30 line-through cursor-not-allowed",
  selected: "bg-accent text-white",
  "today-unbooked": "text-fg border border-transparent",
  "fully-booked":
    "text-muted/50 cursor-not-allowed bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,var(--color-rule)_4px,var(--color-rule)_5px)]",
};

export interface DayCellProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  state: DayCellState;
  day: number; // the day-of-month numeral to render
}

export const DayCell = forwardRef<HTMLButtonElement, DayCellProps>(
  function DayCell({ state, day, className = "", ...props }, ref) {
    const isInteractive = state === "bookable" || state === "selected";
    const isTodayMarked = state === "today-unbooked";
    return (
      <button
        ref={ref}
        type="button"
        disabled={!isInteractive}
        aria-pressed={state === "selected" ? true : undefined}
        className={`${baseClass} ${stateClass[state]} ${className}`}
        {...props}
      >
        {day}
        {isTodayMarked ? (
          <span
            aria-hidden
            className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent"
          />
        ) : null}
      </button>
    );
  },
);
