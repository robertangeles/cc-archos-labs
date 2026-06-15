"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";

// ============================================================================
// DateField — a calendar date picker we render ourselves, so the display is
// always Australian DD/MM/YYYY regardless of the browser's locale. (Chromium's
// native <input type="date"> ignores the page locale and follows the browser's
// UI language, which we can't control — hence this control.)
//
// The value is a calendar date string "YYYY-MM-DD" (or "" for unset), matching
// the server's date column. No Date timezone math touches the value: it is
// parsed and built from its numeric parts, so the day never shifts.
// ============================================================================

interface DateFieldProps {
  id?: string;
  value: string; // "YYYY-MM-DD" or ""
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad2 = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) =>
  `${y}-${pad2(m + 1)}-${pad2(d)}`;

/** Parse "YYYY-MM-DD" into numeric parts. Returns null for empty/invalid. */
function parseIso(v: string): { y: number; m: number; d: number } | null {
  const match = v.match(DATE_PATTERN);
  if (!match) return null;
  return {
    y: Number(match[1]),
    m: Number(match[2]) - 1,
    d: Number(match[3]),
  };
}

/**
 * "2026-06-17" -> "17/06/2026". Australian order, no timezone involved.
 *
 * Exported so read-only views (e.g. contract date ranges) show the same
 * format as the picker. It works purely on the numeric parts of the string,
 * so the displayed day is the stored day for every viewer — see the note on
 * the component above for why a calendar date must not round-trip through a
 * timezone.
 */
export function formatAuDate(v: string | null | undefined): string {
  if (!v) return "";
  const p = parseIso(v);
  if (!p) return "";
  return `${pad2(p.d)}/${pad2(p.m + 1)}/${p.y}`;
}

const formatAu = formatAuDate;

/** Days in a month, and the weekday (Mon=0..Sun=6) the 1st falls on. */
function monthMeta(year: number, month: number) {
  // UTC math gives a stable weekday for the 1st, free of local-zone drift.
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0=Sun
  const mondayFirst = (first + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { lead: mondayFirst, days };
}

export function DateField({
  id,
  value,
  onChange,
  placeholder = "Select a date",
  className = "",
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // The month the calendar is showing — seeded from the value, else today.
  const seed = parseIso(value);
  const todayParts = (() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
  })();
  const [view, setView] = useState({
    y: seed?.y ?? todayParts.y,
    m: seed?.m ?? todayParts.m,
  });

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openCalendar() {
    const s = parseIso(value);
    if (s) setView({ y: s.y, m: s.m });
    setOpen((o) => !o);
  }

  function pick(day: number) {
    onChange(toIso(view.y, view.m, day));
    setOpen(false);
  }

  const { lead, days } = monthMeta(view.y, view.m);
  const cells: (number | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];

  const display = formatAu(value);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        id={id}
        type="button"
        onClick={openCalendar}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-left text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <span className={display ? "text-ink" : "text-ink-tertiary"}>
          {display || placeholder}
        </span>
        <span className="flex items-center gap-1.5">
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange("");
                  setOpen(false);
                }
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-ink-tertiary transition-colors hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <Calendar className="h-4 w-4 text-ink-tertiary" />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-2 w-[280px] rounded-lg border border-hairline bg-surface-1 p-3 shadow-lg">
          {/* Month header */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setView((v) =>
                  v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 },
                )
              }
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-ink">
              {MONTHS[view.m]} {view.y}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setView((v) =>
                  v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 },
                )
              }
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Weekday row (Monday-first, Australian week) */}
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span
                key={w}
                className="py-1 text-[10px] font-medium uppercase text-ink-tertiary"
              >
                {w}
              </span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span key={`b${i}`} />;
              const iso = toIso(view.y, view.m, day);
              const isSelected = iso === value;
              const isToday =
                view.y === todayParts.y &&
                view.m === todayParts.m &&
                day === todayParts.d;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => pick(day)}
                  className={`flex h-8 items-center justify-center rounded-md text-sm transition-colors ${
                    isSelected
                      ? "bg-primary font-medium text-on-primary"
                      : isToday
                        ? "text-ink ring-1 ring-inset ring-hairline-strong hover:bg-surface-2"
                        : "text-ink-subtle hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-2 flex items-center justify-between border-t border-hairline pt-2">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-xs text-ink-tertiary transition-colors hover:text-ink"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(toIso(todayParts.y, todayParts.m, todayParts.d));
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-xs font-medium text-primary transition-colors hover:text-primary-hover"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
