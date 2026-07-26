import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { cronHeartbeat } from "../../../../lib/db/schema";
import { describeRunFailure, sendAlert } from "../../../../lib/blog-agent/alert";
import { getBlogAgentConfig } from "../../../../lib/blog-agent/config";
import { generateBatch } from "../../../../lib/blog-agent/plan";
import { pendingCount } from "../../../../lib/blog-agent/queue";
import { runUntilDrafted } from "../../../../lib/blog-agent/run";

// POST /api/cron/write-blog-post
//
// Render Cron hits this once a day. Auth mirrors /api/cron/process-scheduled-posts
// exactly: a Bearer token shared via CRON_SECRET, constant-time compared, with
// every other caller rejected.
//
// One item per invocation. The run itself takes 3-6 minutes (deep research is
// the slow part), so the Render cron command should allow for it:
//
//   curl --max-time 900 -X POST \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     https://archoslabs.xyz/api/cron/write-blog-post
//
// If curl gives up first, the work still completes — Node does not abort the
// handler when the client disconnects — and the item is released normally. A
// genuinely dead process is covered by the stale-lock sweeper, which runs at
// the top of every invocation.
//
// Nothing here publishes. The agent lands posts as 'scheduled' with
// needs_review set; the existing publisher withholds them until a human clears
// the flag.

export const runtime = "nodejs";
export const maxDuration = 800;

const HEARTBEAT_ID = "blog-writer";

export async function POST(request: NextRequest) {
  // 1. Auth -----------------------------------------------------------------
  //
  // BLOG_CRON_SECRET first, CRON_SECRET as the fallback. Two reasons, and the
  // second is the real one.
  //
  // Practical: this cron was created through the API and is the only service in
  // the account outside the shared environment, so `$CRON_SECRET` expands to
  // nothing in its shell and every run 401s. A secret scoped to this one
  // service fixes that without touching the five crons that work.
  //
  // Security: `CRON_SECRET` opens EVERY cron endpoint. This is the only one
  // that spends real money per call — deep research, four model steps and an
  // image — so it is the one that least deserves a shared key. A dedicated
  // secret means a leak here cannot purge leads or publish posts.
  const expected = process.env.BLOG_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error(
      "[cron/write-blog-post] neither BLOG_CRON_SECRET nor CRON_SECRET is set (or it is too short)",
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
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const runStart = Date.now();

  // 2. Write one post -------------------------------------------------------
  let result;
  try {
    result = await runUntilDrafted(new Date());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/write-blog-post] runUntilDrafted threw:", message);
    await touchHeartbeat({ processed: 0, failed: 1, durationMs: Date.now() - runStart });
    return NextResponse.json(
      { ok: false, error: "Blog agent failed.", detail: message },
      { status: 503 },
    );
  }

  // 3. Refill the queue when it runs low ------------------------------------
  // Deliberately after the run, not before: a slow batch generation should
  // never delay today's post.
  let refill: { inserted: number; error?: string } | undefined;
  const config = await getBlogAgentConfig();
  if (config.enabled) {
    try {
      const pending = await pendingCount();
      if (pending < config.minQueueDepth) {
        const batch = await generateBatch(config);
        refill = { inserted: batch.inserted, error: batch.error };
        if (batch.inserted === 0) {
          await sendAlert({
            kind: "queue-dry",
            to: config.alertEmail,
            subject: "topic queue is running dry",
            body:
              `Only ${pending} item(s) left and the refill produced nothing.\n` +
              `Reason: ${batch.error ?? "unknown"}\n\n` +
              `The agent will keep working the remaining items, then go quiet.`,
          });
        }
      }
    } catch (err) {
      console.error("[cron/write-blog-post] refill failed:", err);
    }
  }

  // 4. Alert on anything that needs a human ---------------------------------
  const needsAttention =
    result.outcome === "failed" || result.outcome === "parked";
  if (needsAttention) {
    await sendAlert({
      kind: result.outcome === "parked" ? "draft-parked" : "item-failed",
      to: config.alertEmail,
      subject:
        result.outcome === "parked"
          ? "a draft was parked for review"
          : "a plan item failed",
      body: describeRunFailure(result),
    });
  }
  if (result.swept && result.swept.exhausted > 0) {
    await sendAlert({
      kind: "locks-exhausted",
      to: config.alertEmail,
      subject: `${result.swept.exhausted} item(s) gave up after repeated failures`,
      body:
        `These plan items were abandoned mid-run too many times and are now marked failed:\n` +
        result.swept.exhaustedIds.map((id) => `  - ${id}`).join("\n") +
        `\n\nRetry them from /admin/blog/pipeline once the cause is known.`,
    });
  }

  // 5. Heartbeat ------------------------------------------------------------
  await touchHeartbeat({
    processed: result.outcome === "drafted" ? 1 : 0,
    failed: needsAttention ? 1 : 0,
    durationMs: Date.now() - runStart,
  });

  return NextResponse.json({
    ok: !needsAttention,
    outcome: result.outcome,
    itemId: result.itemId,
    postId: result.postId,
    detail: result.detail,
    // Not an error — the post is fine, it just took the house illustration.
    // The runbook's "every post is getting the fallback" check reads this.
    imageFallback: result.imageFallback,
    swept: result.swept,
    refill,
  });
}

// ----------------------------------------------------------------------------
// cron_heartbeat row 'blog-writer' — independent from 'posts-publisher' and
// the booking 'singleton' row. This is the monitoring surface for "is the
// agent alive?", separate from "did it produce anything?".
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
    // Heartbeat failure is a soft signal — the main work already succeeded.
    console.error("[cron/write-blog-post] heartbeat update failed:", err);
  }
}

/**
 * Length-leak-safe string compare. Differing lengths return false immediately;
 * equal lengths compare in constant time. Copied from the sibling cron routes
 * so operational behaviour stays uniform.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
