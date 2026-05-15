// Slot math for the Book-a-Call subsystem. Pure functions only — no DB,
// no fetch, no clock reads. The caller in lib/scheduler.ts (and the
// availability route) loads consultant config + blackouts + confirmed
// bookings + Google freebusy, calls `generateSlots()`, and renders the
// result.
//
// Why pure: makes DST + working-hours edge cases unit-testable without
// fixtures or mocks. Every input is data; every output is data.
//
// Tz strategy:
//   - All inputs and outputs are absolute instants (UTC Date / ISO 8601).
//   - working_hours_json is interpreted in `consultant.timezone` — Rob
//     enters "9am Monday in Manila", we walk the slot grid in UTC, and
//     each candidate slot is checked against the wall-clock day/hour in
//     the consultant's tz at that instant (so DST flips just work).
//   - We use Intl.DateTimeFormat (built into Node) for tz conversion —
//     no `date-fns-tz` or similar dependency. The product never ships
//     a half-hour-offset DST consultant (Lord Howe etc.); slot ticks
//     stay aligned to UTC :00/:30 for every offset divisible by 30.

import { z } from "zod";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

// Three-letter lowercase weekday keys, locked to match the JSON shape
// in lib/db/schema.ts consultant.working_hours_json: `{"mon": [9, 17]}`.
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// Hours are integers 0..24 (24 = end-of-day). Closed range; open and
// close hours can be the same to express "unavailable today" (treated
// the same as omitting the key). Missing weekdays are unavailable, so
// the parsed shape is a Partial — `partial()` after `object()` makes
// every key optional and trims unknown keys.
const HOUR_PAIR = z.tuple([
  z.number().int().min(0).max(24),
  z.number().int().min(0).max(24),
]);

export const workingHoursSchema = z
  .object({
    mon: HOUR_PAIR,
    tue: HOUR_PAIR,
    wed: HOUR_PAIR,
    thu: HOUR_PAIR,
    fri: HOUR_PAIR,
    sat: HOUR_PAIR,
    sun: HOUR_PAIR,
  })
  .partial()
  .strict();

export type WorkingHours = z.infer<typeof workingHoursSchema>;

export interface TimeInterval {
  startUtc: Date;
  endUtc: Date;
}

export interface ConsultantConfig {
  timezone: string; // IANA, e.g. "Asia/Manila"
  slotMinutes: number; // typically 30
  slotBufferMinutes: number; // applied to each existing booking + freebusy interval
  advanceDays: number; // typically 14
  minNoticeHours: number; // typically 24
  workingHours: WorkingHours;
}

export interface GenerateSlotsInput {
  config: ConsultantConfig;
  blackouts: TimeInterval[];
  bookings: TimeInterval[]; // existing confirmed bookings (no buffer added by caller)
  freebusy: TimeInterval[]; // Google freebusy intervals (no buffer added by caller)
  now: Date;
}

export interface AvailableSlot {
  startUtc: string; // ISO 8601 UTC
  endUtc: string;
}

// ----------------------------------------------------------------------------
// generateSlots — the entry point
// ----------------------------------------------------------------------------

export function generateSlots(input: GenerateSlotsInput): AvailableSlot[] {
  const { config, blackouts, bookings, freebusy, now } = input;

  const slotMs = config.slotMinutes * 60_000;
  const bufferMs = config.slotBufferMinutes * 60_000;
  const minNoticeMs = config.minNoticeHours * 3_600_000;
  const advanceMs = config.advanceDays * 86_400_000;

  // Window edges: earliest = now + minNotice; latest = now + advance.
  // We align the start to the next slotMinutes boundary in UTC; for
  // every common tz this maps cleanly to a wall-clock :00/:30 mark.
  const windowStartMs = roundUpToSlotMs(now.getTime() + minNoticeMs, slotMs);
  const windowEndMs = now.getTime() + advanceMs;

  // Buffer-expand the conflict sets once so the inner loop is tight.
  // Buffer goes on the existing event, not the candidate slot:
  // bookings/freebusy expand outward by bufferMs on each side. Blackouts
  // are explicit unavailability and intentionally have no buffer.
  const conflicts: Array<{ startMs: number; endMs: number }> = [];
  for (const b of bookings) {
    conflicts.push({
      startMs: b.startUtc.getTime() - bufferMs,
      endMs: b.endUtc.getTime() + bufferMs,
    });
  }
  for (const f of freebusy) {
    conflicts.push({
      startMs: f.startUtc.getTime() - bufferMs,
      endMs: f.endUtc.getTime() + bufferMs,
    });
  }
  const blackoutRanges = blackouts.map((b) => ({
    startMs: b.startUtc.getTime(),
    endMs: b.endUtc.getTime(),
  }));

  const out: AvailableSlot[] = [];

  for (let tMs = windowStartMs; tMs + slotMs <= windowEndMs; tMs += slotMs) {
    const slotEndMs = tMs + slotMs;

    if (overlapsAny(tMs, slotEndMs, conflicts)) continue;
    if (overlapsAny(tMs, slotEndMs, blackoutRanges)) continue;

    if (!fallsWithinWorkingHours(tMs, slotEndMs, config.workingHours, config.timezone)) {
      continue;
    }

    out.push({
      startUtc: new Date(tMs).toISOString(),
      endUtc: new Date(slotEndMs).toISOString(),
    });
  }

  return out;
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

// Round a UTC ms timestamp UP to the next slotMs boundary. Used to
// align the window-start so slot ticks always land on :00/:30 (etc).
function roundUpToSlotMs(ms: number, slotMs: number): number {
  return Math.ceil(ms / slotMs) * slotMs;
}

// Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅
// iff aStart < bEnd && bStart < aEnd.
function overlapsAny(
  startMs: number,
  endMs: number,
  ranges: ReadonlyArray<{ startMs: number; endMs: number }>,
): boolean {
  for (const r of ranges) {
    if (startMs < r.endMs && r.startMs < endMs) return true;
  }
  return false;
}

// Decide whether the slot [slotStartMs, slotEndMs) fits inside the
// working-hours window for the weekday it starts in, evaluated in the
// consultant's tz. Wall-clock check: convert each end to its zoned
// components, require:
//   - same weekday (no slot straddles midnight)
//   - start minute >= openMin
//   - end minute <= closeMin
// `endMinuteInclusive` uses (slotEndMs - 1) so a slot ending exactly at
// closeHour:00 is accepted instead of being kicked into the next day.
function fallsWithinWorkingHours(
  slotStartMs: number,
  slotEndMs: number,
  workingHours: WorkingHours,
  timezone: string,
): boolean {
  const startParts = getZonedParts(slotStartMs, timezone);
  const endParts = getZonedParts(slotEndMs - 1, timezone);

  if (startParts.weekday !== endParts.weekday) return false;
  if (startParts.year !== endParts.year) return false;
  if (startParts.month !== endParts.month) return false;
  if (startParts.day !== endParts.day) return false;

  const hours = workingHours[startParts.weekday];
  if (!hours) return false;

  const [openHour, closeHour] = hours;
  if (openHour === closeHour) return false; // explicit "closed today"

  const openMin = openHour * 60;
  const closeMin = closeHour * 60;
  const startMin = startParts.hour * 60 + startParts.minute;
  // For the end check we use the inclusive last minute of the slot.
  // A 9:30→10:00 slot has endParts at 9:59, endMin=599. closeMin=600
  // → 599 < 600 → accepted. ✓
  const endMin = endParts.hour * 60 + endParts.minute;

  return startMin >= openMin && endMin < closeMin;
}

interface ZonedParts {
  weekday: Weekday;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

// Map Intl's English short-weekday strings to our lowercase 3-letter keys.
const WEEKDAY_FROM_INTL: Record<string, Weekday> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

// Cached formatter per tz — Intl.DateTimeFormat construction is the
// expensive part; reusing the instance is ~10x faster on tight loops.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

function getZonedParts(ms: number, timezone: string): ZonedParts {
  const parts = getFormatter(timezone).formatToParts(new Date(ms));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const weekday = WEEKDAY_FROM_INTL[map.weekday];
  if (!weekday) {
    // Defence in depth — Intl will always emit one of the seven, but if
    // the runtime ever changes locale defaults we'd rather throw than
    // silently return wrong slots.
    throw new Error(`Unknown weekday from Intl: ${map.weekday}`);
  }
  return {
    weekday,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}
