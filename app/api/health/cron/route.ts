import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { cronHeartbeat } from "../../../../lib/db/schema";

// GET /api/health/cron
//
// Public health-check for the scheduled-job cron worker. Returns the
// last_run_at + counts from cron_heartbeat. UptimeRobot (or any other
// monitor) hits this every 5 min and alerts when last_run_at goes
// stale (>10 min). No auth — it's a read-only status endpoint and
// leaks nothing sensitive (just timestamps + counts).
//
// Response shape:
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

export async function GET() {
  try {
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
