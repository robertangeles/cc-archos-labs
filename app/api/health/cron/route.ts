import { NextResponse } from "next/server";
import { desc, eq, max } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import {
  cronHeartbeat,
  newsCandidate,
  newsRadarTick,
} from "../../../../lib/db/schema";
import { readHeartbeat } from "../../../../lib/cron-heartbeat";
import { getIntegrationConfig } from "../../../../lib/integration-config";
import { effectiveXMode } from "../../../../lib/x-articles/mode";
import { countNeedsAttention } from "../../../../lib/x-articles/queue";

// GET /api/health/cron[?id=<cron id>]
//
// Public health-check for the scheduled-job cron workers. UptimeRobot (or any
// other monitor) hits this every 5 min and alerts on a non-2xx. No auth: it's
// a read-only status endpoint and leaks nothing sensitive (timestamps, counts
// and an error class name).
//
// Ids are an allowlist, never interpolated into a query:
//   (none) or singleton  the booking cron's heartbeat, shape below, UNCHANGED
//   news-radar           heartbeat age, a feed frozen behind green ticks, and
//                        the last tick's outcome (see newsRadarHealth)
//   x-articles           heartbeat age, a failed last run, and any X Article
//                        row that needs a person; reports the configured and
//                        the effective mode (see xArticlesHealth)
// Any other id is a 400. The posts-publisher heartbeat is
// written but not monitored here yet.
//
// Default (singleton) response shape:
//   { ok: true,
//     lastRunAt: ISO string | null,
//     lastRunJobsProcessed: number,
//     lastRunJobsFailed: number,
//     lastRunDurationMs: number | null,
//     stale: boolean,           // true if last_run_at > 10 min ago
//     staleAfterMinutes: 10 }
//
// stale=true is the actionable signal for monitoring.

export const runtime = "nodejs";

const STALE_AFTER_MINUTES = 10;

const ALLOWED_IDS = ["singleton", "news-radar", "x-articles"];

// The X phase rides the posts cron, which runs every minute.
const X_ARTICLES_STALE_AFTER_MINUTES = 10;

// A tick runs every 2 hours; one missed tick is tolerated, two are not.
const NEWS_RADAR_STALE_AFTER_MINUTES = 300;
// HuggingNews publishes about 21 items a day. Twelve hours of silence behind
// green ticks means the feed (or our read of it) is broken.
const NEWS_RADAR_FEED_FROZEN_AFTER_HOURS = 12;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "singleton";
  if (!ALLOWED_IDS.includes(id)) {
    return NextResponse.json(
      { ok: false, error: "Unknown cron id." },
      { status: 400 },
    );
  }

  try {
    if (id === "news-radar") return await newsRadarHealth();
    if (id === "x-articles") return await xArticlesHealth();

    const db = getDb();
    const rows = await db
      .select({
        lastRunAt: cronHeartbeat.lastRunAt,
        lastRunJobsProcessed: cronHeartbeat.lastRunJobsProcessed,
        lastRunJobsFailed: cronHeartbeat.lastRunJobsFailed,
        lastRunDurationMs: cronHeartbeat.lastRunDurationMs,
      })
      .from(cronHeartbeat)
      .where(eq(cronHeartbeat.id, "singleton"))
      .limit(1);

    const row = rows[0];
    if (!row) {
      // Never run — fresh deploy. Stale by definition.
      return NextResponse.json(
        {
          ok: true,
          lastRunAt: null,
          lastRunJobsProcessed: 0,
          lastRunJobsFailed: 0,
          lastRunDurationMs: null,
          stale: true,
          staleAfterMinutes: STALE_AFTER_MINUTES,
        },
        // Use 503 so UptimeRobot's "expect 2xx" probe alerts on fresh
        // deploys that haven't started cron yet, not just on a stale
        // heartbeat after past success.
        { status: 503 },
      );
    }

    const ageMs = Date.now() - row.lastRunAt.getTime();
    const stale = ageMs > STALE_AFTER_MINUTES * 60_000;

    return NextResponse.json(
      {
        ok: true,
        lastRunAt: row.lastRunAt.toISOString(),
        lastRunJobsProcessed: row.lastRunJobsProcessed,
        lastRunJobsFailed: row.lastRunJobsFailed,
        lastRunDurationMs: row.lastRunDurationMs,
        stale,
        staleAfterMinutes: STALE_AFTER_MINUTES,
      },
      { status: stale ? 503 : 200 },
    );
  } catch (err) {
    console.error("[health/cron] read failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not read heartbeat." },
      { status: 500 },
    );
  }
}

async function xArticlesHealth() {
  // The config first: if it cannot be read, no query is left running behind the 500.
  const config = await getIntegrationConfig();
  const db = getDb();
  const [heartbeat, needsAttention] = await Promise.all([readHeartbeat("x-articles", db), countNeedsAttention(db)]);
  const base = {
    ok: true,
    id: "x-articles",
    mode: config.xArticlesMode,
    effectiveMode: effectiveXMode(config.xArticlesMode),
    needsAttention,
    staleAfterMinutes: X_ARTICLES_STALE_AFTER_MINUTES,
  };

  if (!heartbeat) {
    return NextResponse.json(
      { ...base, lastRunAt: null, lastRunJobsProcessed: 0, lastRunJobsFailed: 0, stale: true },
      { status: 503 },
    );
  }

  const stale = Date.now() - heartbeat.lastRunAt.getTime() > X_ARTICLES_STALE_AFTER_MINUTES * 60_000;
  const healthy = !stale && heartbeat.failed === 0 && needsAttention === 0;
  return NextResponse.json(
    {
      ...base,
      lastRunAt: heartbeat.lastRunAt.toISOString(),
      lastRunJobsProcessed: heartbeat.processed,
      lastRunJobsFailed: heartbeat.failed,
      stale,
    },
    { status: healthy ? 200 : 503 },
  );
}

async function newsRadarHealth() {
  const db = getDb();
  const heartbeat = await readHeartbeat("news-radar", db);

  if (!heartbeat) {
    return NextResponse.json(
      {
        ok: true,
        id: "news-radar",
        lastRunAt: null,
        lastTick: null,
        newestSourceAt: null,
        lastNewItemAt: null,
        stale: true,
        feedFrozen: false,
        staleAfterMinutes: NEWS_RADAR_STALE_AFTER_MINUTES,
        feedFrozenAfterHours: NEWS_RADAR_FEED_FROZEN_AFTER_HOURS,
      },
      { status: 503 },
    );
  }

  const [tickRows, sourceRows] = await Promise.all([
    db
      .select({
        slotAt: newsRadarTick.slotAt,
        outcome: newsRadarTick.outcome,
        fetched: newsRadarTick.fetched,
        newCount: newsRadarTick.newCount,
        scored: newsRadarTick.scored,
        unscored: newsRadarTick.unscored,
        failedCount: newsRadarTick.failedCount,
        errorClass: newsRadarTick.errorClass,
        rubricVersion: newsRadarTick.rubricVersion,
      })
      .from(newsRadarTick)
      .orderBy(desc(newsRadarTick.slotAt))
      .limit(1),
    db
      .select({
        newestSourceAt: max(newsCandidate.publishedAt),
        lastNewItemAt: max(newsCandidate.firstSeenAt),
      })
      .from(newsCandidate),
  ]);

  const lastTick = tickRows[0] ?? null;
  const newestSourceAt = sourceRows[0]?.newestSourceAt ?? null;
  const lastNewItemAt = sourceRows[0]?.lastNewItemAt ?? null;
  const now = Date.now();

  const stale =
    now - heartbeat.lastRunAt.getTime() >
    NEWS_RADAR_STALE_AFTER_MINUTES * 60_000;
  // A deliberately disabled radar is alive with nothing to read; do not alert.
  const feedFrozen =
    lastTick?.outcome !== "disabled" &&
    (!newestSourceAt ||
      now - newestSourceAt.getTime() >
        NEWS_RADAR_FEED_FROZEN_AFTER_HOURS * 3_600_000);
  const healthy = !stale && !feedFrozen && lastTick?.outcome !== "failed";

  return NextResponse.json(
    {
      ok: true,
      id: "news-radar",
      lastRunAt: heartbeat.lastRunAt.toISOString(),
      lastTick: lastTick && {
        ...lastTick,
        slotAt: lastTick.slotAt.toISOString(),
      },
      newestSourceAt: newestSourceAt?.toISOString() ?? null,
      lastNewItemAt: lastNewItemAt?.toISOString() ?? null,
      stale,
      feedFrozen,
      staleAfterMinutes: NEWS_RADAR_STALE_AFTER_MINUTES,
      feedFrozenAfterHours: NEWS_RADAR_FEED_FROZEN_AFTER_HOURS,
    },
    { status: healthy ? 200 : 503 },
  );
}
