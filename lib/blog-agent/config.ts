import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";
import {
  BLOG_AGENT_CONFIG_STARTER,
  BlogAgentConfigSchema,
  CONFIG_KEY,
  JUDGE_PROMPT_KEY,
  JUDGE_PROMPT_STARTER,
  JudgePromptSchema,
  PLAN_PROMPT_KEY,
  PLAN_PROMPT_STARTER,
  PlanPromptSchema,
  type BlogAgentConfig,
  type JudgePrompt,
  type PlanPrompt,
} from "./config-shared";

// Server-side loaders. Same soft-fallback shape as lib/chat/prompt-config.ts:
// a DB outage or a malformed row degrades to the starter and logs, rather than
// throwing into a cron handler.
//
// The starter for the config is `enabled: false` with placeholder ids, so a
// fallback can never accidentally run the pipeline against garbage — it just
// stops. That is the right failure direction for something that publishes.

async function loadSetting(key: string): Promise<unknown | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, key))
      .limit(1);
    return rows.length > 0 ? rows[0].value : null;
  } catch (err) {
    console.warn(`[blog-agent] DB unreachable loading ${key}:`, err);
    return null;
  }
}

export const getBlogAgentConfig = cache(async (): Promise<BlogAgentConfig> => {
  const value = await loadSetting(CONFIG_KEY);
  if (value === null) return BLOG_AGENT_CONFIG_STARTER;

  const parsed = BlogAgentConfigSchema.safeParse(value);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    console.warn(
      `[blog-agent] ${CONFIG_KEY} failed validation (fields: ${fields}). ` +
        `Falling back to the disabled starter — the pipeline will not run. ` +
        `Fix the site_setting row directly, or re-run scripts/seed-blog-agent-config.mjs. ` +
        `There is no admin screen for it yet.`,
    );
    return BLOG_AGENT_CONFIG_STARTER;
  }
  return parsed.data;
});

export const getJudgePrompt = cache(async (): Promise<JudgePrompt> => {
  const value = await loadSetting(JUDGE_PROMPT_KEY);
  if (value === null) return JUDGE_PROMPT_STARTER;
  const parsed = JudgePromptSchema.safeParse(value);
  if (!parsed.success) {
    console.warn(`[blog-agent] ${JUDGE_PROMPT_KEY} invalid, using starter.`);
    return JUDGE_PROMPT_STARTER;
  }
  return parsed.data;
});

export const getPlanPrompt = cache(async (): Promise<PlanPrompt> => {
  const value = await loadSetting(PLAN_PROMPT_KEY);
  if (value === null) return PLAN_PROMPT_STARTER;
  const parsed = PlanPromptSchema.safeParse(value);
  if (!parsed.success) {
    console.warn(`[blog-agent] ${PLAN_PROMPT_KEY} invalid, using starter.`);
    return PLAN_PROMPT_STARTER;
  }
  return parsed.data;
});

/**
 * Posts the agent may generate this week, from the velocity ramp.
 *
 * The ramp exists because Google names publishing velocity measured against a
 * site's own history as a scaled-content signal, and this blog has 254
 * migrated posts with near-zero recent publishing. Pure function of the
 * config and the date so it is testable without a clock.
 */
export function postsPerWeek(config: BlogAgentConfig, now: Date): number {
  const start = new Date(`${config.velocity.startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return config.velocity.weeklyRamp[0];
  const weeks = Math.floor(
    (now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  const ramp = config.velocity.weeklyRamp;
  if (weeks < 0) return 0;
  return ramp[Math.min(weeks, ramp.length - 1)];
}

/**
 * How far `instant` is offset from UTC in `timeZone`, in milliseconds.
 * Derived from Intl rather than hardcoded, so daylight saving is handled by
 * the platform's tz database instead of by us guessing.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const g = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return asIfUtc - instant.getTime();
}

/**
 * The next time it is `hour`:00 wall-clock in `timeZone`, strictly in the future.
 *
 * Note on "7am AEST": this schedules 7am *local* time in the configured zone.
 * With `Australia/Sydney` that means 7am year-round — UTC+10 in winter (AEST)
 * and UTC+11 over summer (AEDT), because the clocks move and 7am is still 7am.
 * If you meant a fixed UTC+10 offset regardless of season, set the zone to
 * `Australia/Brisbane`, which never observes daylight saving.
 */
export function nextPublishSlot(
  now: Date,
  hour: number,
  timeZone: string,
): Date {
  for (let dayOffset = 0; dayOffset <= 3; dayOffset++) {
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(probe);
    const [y, m, d] = local.split("-").map(Number);

    // Treat the wall clock as UTC, then correct by the zone's offset at that
    // instant. Applied twice so a slot that lands on a DST boundary settles.
    let utc = Date.UTC(y, m - 1, d, hour, 0, 0);
    for (let i = 0; i < 2; i++) {
      utc = Date.UTC(y, m - 1, d, hour, 0, 0) - zoneOffsetMs(new Date(utc), timeZone);
    }

    // A minute of headroom: PostCreateSchema rejects a timestamp in the past,
    // and the run takes minutes, so a slot that is merely "now" would fail.
    if (utc > now.getTime() + 60_000) return new Date(utc);
  }
  // Unreachable in practice — 3 days always contains a future 7am.
  return new Date(now.getTime() + 86_400_000);
}

/**
 * The next publish slot nothing else has already claimed.
 *
 * `nextPublishSlot` answers "when is the next 7am", which is not the same
 * question. Five posts created in one afternoon all get the same answer, and
 * five posts appearing simultaneously is exactly the publishing-velocity spike
 * the whole cadence ramp exists to avoid. Normal operation is one run a day so
 * they rarely collide, but a retry, a manual trigger, or catching up after a
 * stall all produce it — observed with five real posts stacked on one morning.
 *
 * Walks forward a day at a time by re-deriving through `nextPublishSlot`
 * rather than adding 24 hours, so a slot either side of a daylight-saving
 * change still lands on the same wall clock.
 *
 * `taken` should include every scheduled post, not only the agent's. Colliding
 * with something a human scheduled is no better than colliding with itself.
 *
 * Pure, so the walk is testable without a database.
 */
export function nextFreeSlot(
  now: Date,
  hours: number[],
  timeZone: string,
  taken: Iterable<Date>,
  maxSlots = 90,
): Date {
  const claimed = new Set<number>();
  for (const d of taken) claimed.add(d.getTime());

  // Three a day means the stream is 7am, 2pm, 10pm, 7am… — the next slot is
  // whichever configured hour comes soonest, not the next occurrence of one
  // fixed hour. Each candidate is re-derived through nextPublishSlot rather
  // than stepped by a fixed offset, so slots either side of a daylight-saving
  // change still land on the wall clock they were configured for.
  const wanted = hours.length > 0 ? hours : [7];
  let cursor = now;
  let slot = nextPublishSlot(cursor, wanted[0], timeZone);

  for (let i = 0; i < maxSlots; i++) {
    slot = wanted
      .map((h) => nextPublishSlot(cursor, h, timeZone))
      .reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
    if (!claimed.has(slot.getTime())) return slot;
    cursor = new Date(slot.getTime() + 60_000);
  }

  // Everything inside the horizon is taken. A collided slot is a smaller
  // problem than no post at all.
  return slot;
}

/**
 * Should the agent generate today?
 *
 * Spreads N posts across 7 days by day-of-week rather than bunching them at
 * the start of the week: at 2/week that is Monday and Thursday, not Monday and
 * Tuesday. `dayOfYear` keeps it deterministic — the same date always gives the
 * same answer, so a retried cron tick cannot double-publish by drifting.
 */
export function isDueToday(config: BlogAgentConfig, now: Date): boolean {
  const perWeek = postsPerWeek(config, now);
  if (perWeek <= 0) return false;
  if (perWeek >= 7) return true;
  const dayOfWeek = now.getUTCDay(); // 0..6
  // Evenly spaced slots: for 2/week -> days 0 and 3 (of 7).
  for (let i = 0; i < perWeek; i++) {
    if (Math.floor((i * 7) / perWeek) === dayOfWeek) return true;
  }
  return false;
}
