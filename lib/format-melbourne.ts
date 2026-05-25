// Melbourne timezone helpers.
//
// The blog scheduled-publish flow is Melbourne-anchored end-to-end: the
// admin picker (post-form.tsx) interprets wall-time as Australia/Melbourne
// regardless of browser tz, the server stores UTC, and the admin posts
// list (posts-list.tsx) renders back in Melbourne wall-time. Intl handles
// AEDT/AEST DST automatically.
//
// This module is the single source of truth. Both client components (the
// picker and the list) and any server-rendered surface that wants to show
// Melbourne wall-time must import from here — never reformat UTC strings
// inline with `.toISOString().slice(...)`, which renders UTC and reads as
// "one day off" whenever a published_at falls between 14:00 and 23:59 UTC.

export const MELBOURNE_TZ = "Australia/Melbourne";

interface MelbourneParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

/**
 * Get Melbourne wall-time fields (all 2-digit strings except year) for
 * any UTC instant. Internal building block for every formatter below.
 */
export function melbourneParts(utc: Date): MelbourneParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MELBOURNE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(utc);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl returns "24" for midnight in en-CA — normalise to "00" so the
    // datetime-local <input> accepts it.
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
  };
}

/**
 * Format a UTC instant as "YYYY-MM-DD HH:MM" Melbourne wall-time.
 * Used by the admin posts list (Date column).
 */
export function formatMelbourneDateTime(d: Date): string {
  const p = melbourneParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * Format a UTC instant as "MM-DD HH:MM" Melbourne wall-time. Used by the
 * compact chips on the admin posts list (e.g. "scheduled · 05-26 09:00").
 */
export function formatMelbourneShort(d: Date): string {
  const p = melbourneParts(d);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * Split a UTC Date into Melbourne-wall date + time strings, one per
 * split picker (<input type="date"> + <input type="time">). Returns
 * empty strings for null/undefined.
 */
export function splitMelbourneDatetime(
  d: Date | null | undefined,
): { date: string; time: string } {
  if (!d) return { date: "", time: "" };
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const p = melbourneParts(date);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
  };
}

/**
 * Convert a Melbourne wall-time string ("YYYY-MM-DDTHH:MM" — the value
 * <input type="datetime-local"> emits) to a UTC ISO string. DST-aware
 * via Intl.
 *
 * Algorithm:
 *   1. Parse the wall string as if it were UTC ("fake UTC").
 *   2. Format that fake-UTC instant as Melbourne wall-time and compare
 *      back — the delta IS the offset between Melbourne and UTC at that
 *      moment (including any DST adjustment).
 *   3. Subtract the offset from the fake UTC to get the real UTC.
 */
export function melbourneWallToUtcIso(wallString: string): string {
  if (!wallString) return "";
  const fakeUtc = new Date(`${wallString}:00.000Z`);
  if (Number.isNaN(fakeUtc.getTime())) return "";
  const p = melbourneParts(fakeUtc);
  const melAsIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
  );
  const offsetMs = melAsIfUtc - fakeUtc.getTime();
  return new Date(fakeUtc.getTime() - offsetMs).toISOString();
}

/**
 * Human-friendly Melbourne wall-time formatter for the "cron will fire
 * around X" helper text. Takes the wall-string the picker emits;
 * doesn't reach for Intl conversions because the wall string IS already
 * Melbourne wall-time.
 */
export function formatMelbourneForHumans(wallString: string): string {
  if (!wallString) return "";
  const [date, time] = wallString.split("T");
  if (!date || !time) return wallString;
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y} ${time}`;
}

/**
 * Get the current AEDT/AEST short label for display next to the picker.
 * Re-evaluated per call so DST transitions don't lie.
 */
export function melbourneTzAbbrev(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: MELBOURNE_TZ,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "AEDT";
  } catch {
    return "AEDT";
  }
}
