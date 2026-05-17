import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { dispatchJob } from "../../../../lib/cron-dispatch";
import { getDb } from "../../../../lib/db";
import { cronHeartbeat } from "../../../../lib/db/schema";
import { getPublicOrigin } from "../../../../lib/public-origin";
import { getResend } from "../../../../lib/resend";
import {
  dequeueBatch,
  markFailed,
  markSent,
  markSkipped,
  recoverStaleLocks,
} from "../../../../lib/scheduler";

// POST /api/cron/process-scheduled
//
// External cron job (Render Cron) hits this every minute. Auth is a
// Bearer token shared between the cron service and this endpoint via
// CRON_SECRET in env. Every other caller (including the public web) is
// rejected with 401.
//
// Flow per invocation:
//   1. recoverStaleLocks  — pull rows stranded in 'processing' (worker
//                            crashed mid-batch).
//   2. dequeueBatch       — FOR UPDATE SKIP LOCKED on up to BATCH_LIMIT
//                            jobs whose due_at <= now and status=pending.
//   3. For each row, dispatchJob (lib/cron-dispatch) loads the booking,
//      renders the kind-specific email, sends via Resend, and stamps
//      the booking's *_sent_at column. Returns sent / skipped / failed.
//   4. Settle each row (markSent / markSkipped / markFailed). Failure
//      retries up to MAX_ATTEMPTS, then terminal-fails.
//   5. Update cron_heartbeat with run stats.
//
// Returns JSON with a summary. UptimeRobot can poll /api/health/cron
// instead of this endpoint for status — that path is unauthenticated
// and just reads the heartbeat row.

export const runtime = "nodejs";

const BATCH_LIMIT = 20;

export async function POST(request: NextRequest) {
  // 1. Auth -----------------------------------------------------------------
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error(
      "[cron/process-scheduled] CRON_SECRET not set or too short",
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
  if (presented !== expected) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const runStart = Date.now();
  const origin = getPublicOrigin(request);

  // 2. Recover stale locks --------------------------------------------------
  // Rows stuck in 'processing' from a previous worker crash get
  // released so they can be re-dequeued. Lock TTL is 5 min per scheduler.
  let recovered = 0;
  try {
    recovered = await recoverStaleLocks({ now: new Date() });
  } catch (err) {
    console.error(
      "[cron/process-scheduled] recoverStaleLocks failed:",
      err,
    );
  }

  // 3. Dequeue batch --------------------------------------------------------
  const workerId = `render-cron-${runStart}`;
  let batch;
  try {
    batch = await dequeueBatch({
      workerId,
      limit: BATCH_LIMIT,
      now: new Date(),
    });
  } catch (err) {
    console.error("[cron/process-scheduled] dequeueBatch failed:", err);
    await touchHeartbeat({ processed: 0, failed: 1, durationMs: Date.now() - runStart });
    return NextResponse.json(
      { ok: false, error: "Dequeue failed." },
      { status: 503 },
    );
  }

  if (batch.length === 0) {
    await touchHeartbeat({ processed: 0, failed: 0, durationMs: Date.now() - runStart });
    return NextResponse.json({
      ok: true,
      recoveredStale: recovered,
      processed: 0,
      details: [],
    });
  }

  // 4. Resend client + email sender (closure shared across job dispatches) -
  let resendClient: Awaited<ReturnType<typeof getResend>> | null = null;
  async function sendEmail(
    to: string,
    email: { subject: string; text: string; html: string },
  ) {
    if (!resendClient) resendClient = await getResend();
    await resendClient.resend.emails.send({
      from: resendClient.from,
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }

  // 5. Dispatch + settle each job ------------------------------------------
  const results: Array<{
    id: string;
    kind: string;
    outcome: "sent" | "skipped" | "failed";
    detail?: string;
  }> = [];
  let sentCount = 0;
  let failedCount = 0;
  for (const job of batch) {
    let outcome;
    try {
      outcome = await dispatchJob({
        id: job.id,
        kind: job.kind,
        bookingId: job.bookingId,
        attempts: job.attempts,
        origin,
        sendEmail,
      });
    } catch (err) {
      outcome = {
        kind: "failed" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      if (outcome.kind === "sent") {
        await markSent({
          jobId: job.id,
          claudeCostUsd: outcome.claudeCostUsd,
          now: new Date(),
        });
        sentCount++;
        results.push({ id: job.id, kind: job.kind, outcome: "sent" });
      } else if (outcome.kind === "skipped") {
        await markSkipped({
          jobId: job.id,
          reason: outcome.reason,
          now: new Date(),
        });
        results.push({
          id: job.id,
          kind: job.kind,
          outcome: "skipped",
          detail: outcome.reason,
        });
      } else {
        await markFailed({
          jobId: job.id,
          attempts: job.attempts,
          error: outcome.error,
          now: new Date(),
        });
        failedCount++;
        results.push({
          id: job.id,
          kind: job.kind,
          outcome: "failed",
          detail: outcome.error,
        });
      }
    } catch (settleErr) {
      // Settling the row itself failed (DB error). Log + carry on —
      // the row stays locked until the lock TTL expires, then the
      // next run will re-dequeue it.
      console.error(
        "[cron/process-scheduled] settle failed for",
        job.id,
        settleErr,
      );
    }
  }

  await touchHeartbeat({
    processed: sentCount,
    failed: failedCount,
    durationMs: Date.now() - runStart,
  });

  return NextResponse.json({
    ok: true,
    recoveredStale: recovered,
    processed: results.length,
    sent: sentCount,
    failed: failedCount,
    details: results,
  });
}

// ----------------------------------------------------------------------------
// cron_heartbeat — single-row table, last_run timestamps + stats
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
      .where(eq(cronHeartbeat.id, "singleton"))
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
        .where(eq(cronHeartbeat.id, "singleton"));
    } else {
      await db.insert(cronHeartbeat).values({
        id: "singleton",
        lastRunAt: now,
        lastRunJobsProcessed: input.processed,
        lastRunJobsFailed: input.failed,
        lastRunDurationMs: input.durationMs,
      });
    }
  } catch (err) {
    // Heartbeat failure is a soft signal — the main work succeeded.
    console.error("[cron/process-scheduled] heartbeat update failed:", err);
  }
}
