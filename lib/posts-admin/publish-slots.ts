// shortcut: no lock around "pick a slot, then save the post", so two pipeline runs at the same instant can pick the same slot and two posts publish together; fine with one cron worker, upgrade if drafts are ever created concurrently.
//
// The publishing cadence: a few fixed wall-clock times a day in one named zone
// (default 9:00, 15:00 and 21:00 New York). A new draft takes the next slot no
// post already holds, and the existing scheduled publisher (cron, every minute)
// does the rest. That publisher already refuses to publish an agent-written post
// that still needs review, so a slot only goes live once a human has cleared
// the post; an unreviewed post simply waits.
//
// The schedule is a `site_setting` row, `blog_publish_slots`, so it can be
// changed without a deploy. A row that does not parse is an error, not a
// fallback: quietly scheduling at the default times when someone configured
// something else would be worse than refusing.
//
// The hard part is daylight saving. 9:00 in New York is 13:00 UTC in summer and
// 14:00 UTC in winter, so slots are computed from the zone's own rules (Intl),
// never from a fixed offset.

import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { post, siteSetting } from "../db/schema";

export const PUBLISH_SLOTS_KEY = "blog_publish_slots";

export interface PublishSlots {
  /** IANA zone name, e.g. "America/New_York". */
  timeZone: string;
  /** Local "HH:MM" times, 24-hour, sorted. */
  times: string[];
}

export const DEFAULT_PUBLISH_SLOTS: PublishSlots = {
  timeZone: "America/New_York",
  times: ["09:00", "15:00", "21:00"],
};

// A slot closer than this is not handed out. Saving a scheduled post requires a
// future time, and the clock moves between choosing a slot and saving.
const MIN_LEAD_MS = 2 * 60_000;

/** The stored schedule is missing a field, has a bad time, or names an unknown zone. */
export class PublishSlotsConfigError extends Error {
  override name = "PublishSlotsConfigError";
}

const SlotsSchema = z.object({
  timeZone: z.string().min(1),
  times: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
    .min(1)
    .max(8),
});

export function parsePublishSlots(raw: unknown): PublishSlots {
  const parsed = SlotsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PublishSlotsConfigError(`blog_publish_slots is not valid: ${parsed.error.issues[0]?.message ?? "bad shape"}`);
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timeZone });
  } catch {
    throw new PublishSlotsConfigError(`blog_publish_slots names an unknown time zone: ${parsed.data.timeZone}`);
  }
  return { timeZone: parsed.data.timeZone, times: [...new Set(parsed.data.times)].sort() };
}

// --- zone maths -------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(ms: number, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    // h23, not hour12:false, which prints midnight as "24" in some engines.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second };
}

// How far the zone's wall clock is ahead of UTC at this instant, in ms.
function offsetMs(ms: number, timeZone: string): number {
  const z = zonedParts(ms, timeZone);
  return Date.UTC(z.y, z.m - 1, z.d, z.hh, z.mm, z.ss) - Math.floor(ms / 1000) * 1000;
}

/**
 * The UTC instant at which a zone's wall clock reads `time` on a calendar day.
 * Null when that local time does not exist (the hour skipped when clocks spring
 * forward), so the slot is skipped for that day rather than invented.
 */
export function slotInstant(y: number, m: number, d: number, time: string, timeZone: string): Date | null {
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes: the first offset is taken at a guess that may sit on the wrong
  // side of a clock change, the second at the corrected instant.
  let utc = guess - offsetMs(guess, timeZone);
  utc = guess - offsetMs(utc, timeZone);
  const back = zonedParts(utc, timeZone);
  return back.y === y && back.m === m && back.d === d && back.hh === hh && back.mm === mm ? new Date(utc) : null;
}

/** The first slot strictly after `after` that is not in `taken`. Pure. */
export function nextFreeSlot(
  after: Date,
  taken: Date[],
  slots: PublishSlots,
  opts: { horizonDays?: number } = {},
): Date {
  const horizonDays = opts.horizonDays ?? 60;
  const takenMs = new Set(taken.map((t) => t.getTime()));
  // Start from the zone's calendar date, not the UTC one: at 22:00 in New York
  // it is already tomorrow in UTC.
  const start = zonedParts(after.getTime(), slots.timeZone);
  for (let i = 0; i <= horizonDays; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    for (const t of slots.times) {
      const at = slotInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), t, slots.timeZone);
      if (at && at.getTime() > after.getTime() && !takenMs.has(at.getTime())) return at;
    }
  }
  throw new Error(`no free publish slot in the next ${horizonDays} days`);
}

// --- database ---------------------------------------------------------------

export async function getPublishSlots(db: DB): Promise<PublishSlots> {
  const rows = await db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, PUBLISH_SLOTS_KEY))
    .limit(1);
  return rows.length === 0 ? DEFAULT_PUBLISH_SLOTS : parsePublishSlots(rows[0].value);
}

/** The slot a new draft should be scheduled for: the next one no scheduled post holds. */
export async function nextPublishSlot(db: DB, now: Date = new Date()): Promise<Date> {
  const slots = await getPublishSlots(db);
  const rows = await db
    .select({ at: post.scheduledPublishAt })
    .from(post)
    .where(and(eq(post.status, "scheduled"), gt(post.scheduledPublishAt, now)));
  const taken = rows.flatMap((r) => (r.at ? [r.at] : []));
  return nextFreeSlot(new Date(now.getTime() + MIN_LEAD_MS), taken, slots);
}
