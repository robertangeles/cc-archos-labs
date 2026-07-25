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
        `Fix it at /admin/prompts/blog-agent-config.`,
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
