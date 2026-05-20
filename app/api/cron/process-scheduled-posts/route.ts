import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { cronHeartbeat } from "../../../../lib/db/schema";
import { publishScheduledPosts } from "../../../../lib/posts-admin/scheduled-publisher";

// POST /api/cron/process-scheduled-posts
//
// External cron job (Render Cron) hits this every minute. Auth is a
// Bearer token shared between the cron service and this endpoint via
// CRON_SECRET in env. Every other caller (including the public web) is
// rejected with 401. Mirrors /api/cron/process-scheduled (booking
// emails) exactly so operational behaviour stays uniform.
//
// Flow per invocation:
//   1. Verify CRON_SECRET (constant-time compare).
//   2. publishScheduledPosts(now) — atomically flip any rows whose
//      scheduled_publish_at <= now and status='scheduled'.
//   3. Update cron_heartbeat id='posts-publisher' with run stats.
//   4. Return JSON summary.
//
// Heartbeat is the single source of monitoring truth. UptimeRobot polls
// /api/health/cron (when that route lands; presently only the booking
// heartbeat is monitored). Failed runs increment last_run_jobs_failed
// so the dashboard surfaces them.

export const runtime = "nodejs";

const HEARTBEAT_ID = "posts-publisher";

export async function POST(request: NextRequest) {
  // 1. Auth -----------------------------------------------------------------
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error(
      "[cron/process-scheduled-posts] CRON_SECRET not set or too short",
    );
    return NextResponse.json(
      { ok: false, error: "Cron not configured." },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!constantTimeEqual(presented, expected)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const runStart = Date.now();

  // 2. Publish due-now posts -----------------------------------------------
  let result;
  try {
    result = await publishScheduledPosts(new Date());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[cron/process-scheduled-posts] publishScheduledPosts threw:",
      message,
    );
    await touchHeartbeat({
      processed: 0,
      failed: 1,
      durationMs: Date.now() - runStart,
    });
    return NextResponse.json(
      { ok: false, error: "Publisher failed.", detail: message },
      { status: 503 },
    );
  }

  // 3. Heartbeat -----------------------------------------------------------
  await touchHeartbeat({
    processed: result.published,
    failed: result.failed,
    durationMs: Date.now() - runStart,
  });

  return NextResponse.json({
    ok: result.ok,
    processed: result.processed,
    published: result.published,
    raced: result.raced,
    failed: result.failed,
    details: result.details,
  });
}

// ----------------------------------------------------------------------------
// cron_heartbeat row 'posts-publisher' — independent from the booking
// heartbeat row 'singleton'. /api/health/cron will be extended to read
// both rows when monitoring is wired through.
// ----------------------------------------------------------------------------

async function touchHeartbeat(input: {
  processed: number;
  failed: number;
  durationMs: number;
}): Promise<void> {
  try {
    const now = new Date();
    const db = getDb();
    const existing = await db
      .select({ id: cronHeartbeat.id })
      .from(cronHeartbeat)
      .where(eq(cronHeartbeat.id, HEARTBEAT_ID))
      .limit(1);
    if (existing[0]) {
      await db
        .update(cronHeartbeat)
        .set({
          lastRunAt: now,
          lastRunJobsProcessed: input.processed,
          lastRunJobsFailed: input.failed,
          lastRunDurationMs: input.durationMs,
          updatedAt: now,
        })
        .where(eq(cronHeartbeat.id, HEARTBEAT_ID));
    } else {
      await db.insert(cronHeartbeat).values({
        id: HEARTBEAT_ID,
        lastRunAt: now,
        lastRunJobsProcessed: input.processed,
        lastRunJobsFailed: input.failed,
        lastRunDurationMs: input.durationMs,
      });
    }
  } catch (err) {
    // Heartbeat failure is a soft signal — the main work succeeded.
    console.error(
      "[cron/process-scheduled-posts] heartbeat update failed:",
      err,
    );
  }
}

/**
 * Length-leak-safe string compare. Both inputs must be the same length
 * to return true; differing lengths return false in constant time.
 * Adequate for a secret with high entropy + uniform length.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
