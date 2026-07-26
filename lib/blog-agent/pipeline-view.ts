import "server-only";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { category, contentPlanItem, cronHeartbeat, post } from "../db/schema";
import { getBlogAgentConfig, isDueToday, postsPerWeek } from "./config";

// Everything /admin/blog/pipeline renders, in one place.
//
// The page answers four questions in order: is it alive, is anything wrong,
// what is queued, and did the thing I approved actually go out. The last one
// needs a join against `post`, because `published` is deliberately not a queue
// status — the scheduled publisher owns post.status and the queue owns its own,
// one writer per column.

/** How long after its last run the agent counts as stalled rather than idle. */
const STALE_AFTER_MS = 25 * 60 * 60 * 1000;

export type HealthTone = "running" | "stopped" | "stalled" | "never-run";

export interface AgentHealth {
  tone: HealthTone;
  /** Short enough to read at a glance. */
  headline: string;
  /** One sentence saying what that means for the site. */
  detail: string;
  lastRunAt: Date | null;
  dueToday: boolean;
  postsThisWeek: number;
  targetThisWeek: number;
}

/**
 * Turn config plus a heartbeat into something an operator can read in a second.
 *
 * Pure so it can be tested without a clock or a database. The case that
 * matters is `stalled`: an agent that is switched on but has not run in over a
 * day looks identical to a healthy one if you only render the timestamp, and
 * the failure it represents — the cron itself not firing — is invisible from
 * inside the application.
 */
export function describeHealth(input: {
  enabled: boolean;
  lastRunAt: Date | null;
  now: Date;
  dueToday: boolean;
  postsThisWeek: number;
  targetThisWeek: number;
}): AgentHealth {
  const { enabled, lastRunAt, now, dueToday, postsThisWeek, targetThisWeek } = input;
  const base = { lastRunAt, dueToday, postsThisWeek, targetThisWeek };

  if (!enabled) {
    return {
      ...base,
      tone: "stopped",
      headline: "Stopped",
      detail:
        "The agent will not run or spend anything. Posts already approved still publish on their own timer.",
    };
  }

  if (!lastRunAt) {
    return {
      ...base,
      tone: "never-run",
      headline: "Never run",
      detail:
        "Switched on, but it has not run once. If that is unexpected, the scheduled job is probably not set up.",
    };
  }

  if (now.getTime() - lastRunAt.getTime() > STALE_AFTER_MS) {
    return {
      ...base,
      tone: "stalled",
      headline: "Not running",
      detail:
        "Switched on, but it has not checked in for over a day. That points at the scheduled job rather than at the agent.",
    };
  }

  return {
    ...base,
    tone: "running",
    headline: "Running",
    detail: dueToday
      ? "Today is a publishing day. Nothing it writes reaches the public site until you clear the review flag."
      : "Healthy, and not scheduled to write today. Cadence is set in settings.",
  };
}

export interface QueueRowPost {
  id: string;
  slug: string;
  /** What was actually written, which is not the plan item's title. */
  title: string;
  status: string;
  needsReview: boolean;
  scheduledPublishAt: Date | null;
}

export interface JudgeFinding {
  tell: string;
  quote: string;
  why: string;
}

export interface JudgeRound {
  round: number;
  findings: JudgeFinding[];
}

export interface QueueRow {
  id: string;
  dayNumber: number;
  title: string;
  status: string;
  attempts: number;
  lastError: string | null;
  categoryName: string | null;
  createdAt: Date;
  post: QueueRowPost | null;
  /** Empty when the item never reached the reviewer. */
  rounds: JudgeRound[];
}

/**
 * Flatten the stored verdict into rounds of quotable findings.
 *
 * `judge_verdict` is written by run.ts as `{rounds: [{round, gate, judge}]}`,
 * where gate findings carry a severity and judge findings do not. Only hard
 * gate failures are shown: a soft signal is tuning information, not a reason
 * the post was parked, and mixing them makes the panel look like a wall of
 * complaints rather than an answer.
 *
 * Returns [] on anything unexpected. A verdict written by an older shape must
 * not take the page down.
 */
export function parseVerdict(raw: unknown): JudgeRound[] {
  if (!raw || typeof raw !== "object") return [];
  const rounds = (raw as { rounds?: unknown }).rounds;
  if (!Array.isArray(rounds)) return [];

  const out: JudgeRound[] = [];
  for (const entry of rounds) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as {
      round?: unknown;
      gate?: unknown;
      judge?: { findings?: unknown };
    };

    const findings: JudgeFinding[] = [];
    const push = (f: unknown, whyKey: "note" | "why") => {
      if (!f || typeof f !== "object") return;
      const x = f as Record<string, unknown>;
      if (typeof x.quote !== "string" || !x.quote.trim()) return;
      findings.push({
        tell: typeof x.tell === "string" ? x.tell : "unknown",
        quote: x.quote,
        why: typeof x[whyKey] === "string" ? (x[whyKey] as string) : "",
      });
    };

    if (Array.isArray(e.gate)) {
      for (const f of e.gate) {
        if ((f as { severity?: string })?.severity === "hard") push(f, "note");
      }
    }
    if (Array.isArray(e.judge?.findings)) {
      for (const f of e.judge.findings) push(f, "why");
    }

    out.push({
      round: typeof e.round === "number" ? e.round : out.length,
      findings,
    });
  }
  return out;
}

export interface PublishedRow {
  id: string;
  slug: string;
  title: string;
  publishedAt: Date | null;
}

export interface PipelineView {
  health: AgentHealth;
  rows: QueueRow[];
  published: PublishedRow[];
  /** Non-null when the config itself is unusable. */
  configProblem: string | null;
}

export async function loadPipelineView(now: Date = new Date()): Promise<PipelineView> {
  const db = getDb();
  const config = await getBlogAgentConfig();

  // The starter's placeholder workflow id is the tell that the stored config
  // failed validation and the agent is running on a disabled default.
  const configProblem =
    config.workflowId === "00000000-0000-0000-0000-000000000000"
      ? "The stored settings are missing or invalid, so the agent is running on a disabled default. Open Settings to repair them."
      : null;

  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [heartbeatRows, itemRows, publishedRows, weekCount] = await Promise.all([
    db
      .select({ lastRunAt: cronHeartbeat.lastRunAt })
      .from(cronHeartbeat)
      .where(eq(cronHeartbeat.id, "blog-writer"))
      .limit(1),
    db
      .select({
        id: contentPlanItem.id,
        dayNumber: contentPlanItem.dayNumber,
        title: contentPlanItem.title,
        status: contentPlanItem.status,
        attempts: contentPlanItem.attempts,
        lastError: contentPlanItem.lastError,
        createdAt: contentPlanItem.createdAt,
        judgeVerdict: contentPlanItem.judgeVerdict,
        categoryName: category.name,
        postId: post.id,
        postSlug: post.slug,
        postTitle: post.title,
        postStatus: post.status,
        postNeedsReview: post.needsReview,
        postScheduledPublishAt: post.scheduledPublishAt,
      })
      .from(contentPlanItem)
      .leftJoin(category, eq(category.id, contentPlanItem.categoryId))
      .leftJoin(post, eq(post.id, contentPlanItem.postId))
      // Anything needing attention first, then batch order. `failed` and
      // `running` sort above the rest because they are the only rows a human
      // can do something about.
      .orderBy(
        sql`CASE ${contentPlanItem.status}
              WHEN 'failed' THEN 0
              WHEN 'running' THEN 1
              WHEN 'pending' THEN 2
              ELSE 3 END`,
        contentPlanItem.dayNumber,
      )
      .limit(50),
    db
      .select({
        id: post.id,
        slug: post.slug,
        title: post.title,
        publishedAt: post.publishedAt,
      })
      .from(post)
      .where(and(eq(post.isAgentGenerated, true), eq(post.status, "published")))
      .orderBy(desc(post.publishedAt))
      .limit(5),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(post)
      .where(
        and(
          eq(post.isAgentGenerated, true),
          isNotNull(post.publishedAt),
          gte(post.publishedAt, weekAgo),
        ),
      ),
  ]);

  return {
    health: describeHealth({
      enabled: config.enabled,
      lastRunAt: heartbeatRows[0]?.lastRunAt ?? null,
      now,
      dueToday: isDueToday(config, now),
      postsThisWeek: weekCount[0]?.n ?? 0,
      targetThisWeek: postsPerWeek(config, now),
    }),
    rows: itemRows.map((r) => ({
      id: r.id,
      dayNumber: r.dayNumber,
      title: r.title,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError,
      categoryName: r.categoryName,
      createdAt: r.createdAt,
      post: r.postId
        ? {
            id: r.postId,
            slug: r.postSlug!,
            title: r.postTitle!,
            status: r.postStatus!,
            needsReview: !!r.postNeedsReview,
            scheduledPublishAt: r.postScheduledPublishAt,
          }
        : null,
      rounds: parseVerdict(r.judgeVerdict),
    })),
    published: publishedRows,
    configProblem,
  };
}
