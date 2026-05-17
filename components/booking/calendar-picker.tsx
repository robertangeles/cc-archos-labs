"use client";

import { useMemo, useState } from "react";

// Shared slot-picker used by the public booking page AND the
// reschedule flow on the manage page. Same UX in both surfaces —
// month-grid calendar + part-of-day grouped time pills + a "Next
// available" chip — so visitors hit a consistent picker no matter
// the entry point.

export interface AvailableSlotWire {
  startUtc: string;
  endUtc: string;
}

// ----------------------------------------------------------------------------
// "Next available" quick-pick chip
// ----------------------------------------------------------------------------
// Single-click "skip the calendar" affordance. Premium booking flows
// (Cal.com / SavvyCal) place this at the top of the picker so visitors
// who don't care which slot can book in one tap.

export function NextAvailableChip({
  slot,
  dateKey,
  prospectTimezone,
  onPick,
}: {
  slot: AvailableSlotWire;
  dateKey: string;
  prospectTimezone: string;
  onPick: (slot: AvailableSlotWire, dateKey: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(slot, dateKey)}
      className="group inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-body-sm text-primary transition-colors duration-150 hover:bg-primary/10"
    >
      <span className="text-eyebrow uppercase text-primary/70 group-hover:text-primary">
        Next available
      </span>
      <span className="font-medium">
        {formatNextAvailableLabel(slot.startUtc, prospectTimezone)}
      </span>
    </button>
  );
}

// ----------------------------------------------------------------------------
// CalendarPicker — month grid + time pills
// ----------------------------------------------------------------------------

export interface CalendarPickerProps {
  slotsByDate: Record<string, AvailableSlotWire[]>;
  // Sorted ISO YYYY-MM-DD strings of dates that have at least one slot.
  dateKeys: string[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  selectedSlot: AvailableSlotWire | null;
  onSelectSlot: (slot: AvailableSlotWire) => void;
  prospectTimezone: string;
}

export function CalendarPicker({
  slotsByDate,
  dateKeys,
  selectedDate,
  onSelectDate,
  selectedSlot,
  onSelectSlot,
  prospectTimezone,
}: CalendarPickerProps) {
  // Default the displayed month to the month of the earliest available
  // date. Visitors should land on a month that actually has slots.
  const initialMonth = useMemo(() => {
    const first = dateKeys[0];
    if (first) {
      const [y, m] = first.split("-").map(Number);
      return { year: y, month: m - 1 };
    }
    const today = todayInTz(prospectTimezone);
    return { year: today.year, month: today.month - 1 };
  }, [dateKeys, prospectTimezone]);

  const [displayedMonth, setDisplayedMonth] = useState<{
    year: number;
    month: number;
  }>(initialMonth);

  const availableSet = useMemo(() => new Set(dateKeys), [dateKeys]);
  const firstAvailable = dateKeys[0] ?? null;
  const lastAvailable = dateKeys[dateKeys.length - 1] ?? null;

  // Allow prev/next month nav only within the range covered by the
  // available-dates window. Avoids dead-end navigation past Dec when
  // the booking window only extends 14 days.
  const canGoPrev = useMemo(() => {
    if (!firstAvailable) return false;
    const [y, m] = firstAvailable.split("-").map(Number);
    return (
      displayedMonth.year > y ||
      (displayedMonth.year === y && displayedMonth.month > m - 1)
    );
  }, [displayedMonth, firstAvailable]);

  const canGoNext = useMemo(() => {
    if (!lastAvailable) return false;
    const [y, m] = lastAvailable.split("-").map(Number);
    return (
      displayedMonth.year < y ||
      (displayedMonth.year === y && displayedMonth.month < m - 1)
    );
  }, [displayedMonth, lastAvailable]);

  const gridCells = useMemo(
    () => buildMonthGrid(displayedMonth.year, displayedMonth.month),
    [displayedMonth],
  );

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
      }).format(new Date(displayedMonth.year, displayedMonth.month, 1)),
    [displayedMonth],
  );

  const slotsForSelectedDate = selectedDate
    ? slotsByDate[selectedDate] ?? []
    : [];

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
      {/* Calendar grid */}
      <div className="w-full md:w-[300px]">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setDisplayedMonth(addMonth(displayedMonth, -1))}
            disabled={!canGoPrev}
            aria-label="Previous month"
            className="rounded-md border border-hairline px-2 py-1 text-body-sm text-ink-subtle transition-colors duration-150 hover:bg-surface-1 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            ←
          </button>
          <p className="text-body-sm font-medium text-ink">{monthLabel}</p>
          <button
            type="button"
            onClick={() => setDisplayedMonth(addMonth(displayedMonth, 1))}
            disabled={!canGoNext}
            aria-label="Next month"
            className="rounded-md border border-hairline px-2 py-1 text-body-sm text-ink-subtle transition-colors duration-150 hover:bg-surface-1 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            →
          </button>
        </div>

        {/* Weekday header — Monday-first (AU/EU convention) */}
        <div className="grid grid-cols-7 gap-1 pb-2 text-center">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span
              key={i}
              className="text-eyebrow uppercase text-ink-subtle/60"
            >
              {d}
            </span>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {gridCells.map((cell) => {
            const cellKey = isoDate(cell);
            const isCurrentMonth = cell.getMonth() === displayedMonth.month;
            const isAvailable = isCurrentMonth && availableSet.has(cellKey);
            const isSelected = isAvailable && cellKey === selectedDate;
            return (
              <button
                key={cellKey + (isCurrentMonth ? "" : "_o")}
                type="button"
                onClick={() => {
                  if (isAvailable) onSelectDate(cellKey);
                }}
                disabled={!isAvailable}
                aria-label={cellKey}
                className={`aspect-square rounded-md text-body-sm transition-colors duration-150 ${
                  isSelected
                    ? "bg-primary text-on-primary"
                    : isAvailable
                      ? "bg-surface-2 text-ink hover:bg-surface-3"
                      : isCurrentMonth
                        ? "text-ink-subtle/40"
                        : "text-ink-subtle/20"
                }`}
              >
                {cell.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time pills for selected day, grouped by part-of-day */}
      <div className="min-h-[12rem]">
        {selectedDate ? (
          <>
            <p className="mb-3 text-body-sm font-medium text-ink">
              {formatDateLabel(selectedDate, prospectTimezone)}
            </p>
            <div className="flex max-h-80 flex-col gap-4 overflow-y-auto">
              {groupSlotsByPartOfDay(
                slotsForSelectedDate,
                prospectTimezone,
              ).map((group) =>
                group.slots.length === 0 ? null : (
                  <div key={group.label}>
                    <p className="mb-2 text-eyebrow uppercase text-ink-subtle">
                      {group.label}
                    </p>
                    <div className="flex flex-wrap content-start gap-2">
                      {group.slots.map((slot) => {
                        const isSelected =
                          selectedSlot?.startUtc === slot.startUtc;
                        return (
                          <button
                            key={slot.startUtc}
                            type="button"
                            onClick={() => onSelectSlot(slot)}
                            className={`rounded-md border px-3 py-2 text-body-sm transition-colors duration-150 ${
                              isSelected
                                ? "border-primary bg-primary text-on-primary"
                                : "border-hairline text-ink hover:border-hairline-strong"
                            }`}
                          >
                            {formatTimeLabel(slot.startUtc, prospectTimezone)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ),
              )}
            </div>
          </>
        ) : (
          <p className="text-body-sm text-ink-subtle">
            Pick a day to see available times.
          </p>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers — exported because the parent form needs them for slot
// grouping + label formatting outside the picker itself.
// ----------------------------------------------------------------------------

export function groupSlotsByDate(
  slots: AvailableSlotWire[],
  timezone: string,
): Record<string, AvailableSlotWire[]> {
  const out: Record<string, AvailableSlotWire[]> = {};
  for (const s of slots) {
    const dateKey = isoDateInTz(s.startUtc, timezone);
    if (!out[dateKey]) out[dateKey] = [];
    out[dateKey].push(s);
  }
  return out;
}

export function formatSlotLabel(
  slot: AvailableSlotWire,
  timezone: string,
): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(slot.startUtc));
  } catch {
    return slot.startUtc;
  }
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function formatNextAvailableLabel(utcIso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(utcIso));
  } catch {
    return utcIso;
  }
}

// Bucket slots by part-of-day in the prospect's tz. Pure UX win:
// "afternoon" is a more useful filter than a flat list of 12 pills.
function groupSlotsByPartOfDay(
  slots: AvailableSlotWire[],
  timezone: string,
): { label: string; slots: AvailableSlotWire[] }[] {
  const morning: AvailableSlotWire[] = [];
  const afternoon: AvailableSlotWire[] = [];
  const evening: AvailableSlotWire[] = [];
  for (const slot of slots) {
    const hour = hourInTz(slot.startUtc, timezone);
    if (hour < 12) morning.push(slot);
    else if (hour < 17) afternoon.push(slot);
    else evening.push(slot);
  }
  return [
    { label: "Morning", slots: morning },
    { label: "Afternoon", slots: afternoon },
    { label: "Evening", slots: evening },
  ];
}

function hourInTz(utcIso: string, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utcIso));
    const h = parts.find((p) => p.type === "hour")?.value;
    return Number(h);
  } catch {
    return 0;
  }
}

// 6 weeks × 7 days = 42 cells starting from the Monday on or before the
// 1st of the month. Cells outside the current month are rendered greyed
// (preserves the standard 6-row calendar grid that doesn't visually jump).
function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const dayOfWeek = firstOfMonth.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = (dayOfWeek + 6) % 7; // Sun→6, Mon→0, ..., Sat→5
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(year, month, 1 - mondayOffset + i));
  }
  return cells;
}

function addMonth(
  current: { year: number; month: number },
  delta: number,
): { year: number; month: number } {
  const m = current.month + delta;
  const yearShift = Math.floor(m / 12);
  const normalised = ((m % 12) + 12) % 12;
  return { year: current.year + yearShift, month: normalised };
}

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoDateInTz(utcIso: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(utcIso));
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return utcIso.slice(0, 10);
  }
}

function formatDateLabel(dateKey: string, timezone: string): string {
  try {
    // dateKey is "YYYY-MM-DD" — treat as a date in the tz at noon to
    // avoid DST edge cases when reading back into Intl.
    const [y, m, d] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return dateKey;
  }
}

function formatTimeLabel(utcIso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(utcIso));
  } catch {
    return utcIso.slice(11, 16);
  }
}

function todayInTz(timezone: string): {
  year: number;
  month: number;
  day: number;
} {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
    };
  } catch {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    };
  }
}
