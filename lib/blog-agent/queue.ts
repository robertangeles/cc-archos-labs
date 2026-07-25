import "server-only";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { contentPlanItem } from "../db/schema";

// Queue mechanics for the blog agent: claim one item, release it, sweep the
// wreckage of a crashed run.
//
// The claim is modelled on lib/scheduler.ts:160 (the booking-email queue) and
// deliberately NOT on lib/posts-admin/scheduled-publisher.ts. The publisher's
// comment describes a lock held across both stages, but its transaction
// commits — and releases the lock — as soon as the SELECT returns, and the
// per-row UPDATE then runs in a separate transaction. It is safe anyway,
// because publishing is idempotent and guarded by WHERE status='scheduled'.
//
// Claiming a queue item is not idempotent. A run takes 3-6 minutes and spends
// real money on deep research, so two workers claiming the same row means two
// posts and two bills for one plan item. The SELECT ... FOR UPDATE SKIP LOCKED
// and the claiming UPDATE therefore happen inside ONE transaction, which is
// what actually holds the lock.
//
// The transaction closes at the claim. The workflow runs outside it — holding
// a transaction open for six minutes would pin a connection and block vacuum.
// `locked_until` covers the window after the transaction closes: if the process
// dies mid-run, the sweeper reclaims the row once that stamp elapses.

/** How long a claimed item may stay 'running' before the sweeper reclaims it. */
export const LOCK_TTL_MS = 15 * 60 * 1000;

/** Give up on an item after this many attempts and alert instead. */
export const MAX_ATTEMPTS = 3;

export type ClaimedItem = typeof contentPlanItem.$inferSelect;

/**
 * Claim the next pending item, or null when the queue is empty.
 *
 * `workerId` identifies the claiming run in `locked_by` so a wedged row can be
 * traced back to the invocation that abandoned it.
 */
export async function claimNextItem(
  workerId: string,
  now: Date = new Date(),
): Promise<ClaimedItem | null> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: contentPlanItem.id })
      .from(contentPlanItem)
      .where(eq(contentPlanItem.status, "pending"))
      .orderBy(asc(contentPlanItem.dayNumber))
      .limit(1)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return null;

    const claimed = await tx
      .update(contentPlanItem)
      .set({
        status: "running",
        lockedBy: workerId,
        lockedUntil: new Date(now.getTime() + LOCK_TTL_MS),
        attempts: sql`${contentPlanItem.attempts} + 1`,
        updatedAt: now,
      })
      .where(eq(contentPlanItem.id, rows[0].id))
      .returning();

    return claimed[0] ?? null;
  });
}

/** Terminal states an item can be released into. */
export type ReleaseStatus = "drafted" | "failed" | "skipped" | "pending";

export async function releaseItem(
  id: string,
  status: ReleaseStatus,
  extra: {
    postId?: string | null;
    lastError?: string | null;
    judgeVerdict?: unknown;
  } = {},
  now: Date = new Date(),
): Promise<void> {
  const db = getDb();
  await db
    .update(contentPlanItem)
    .set({
      status,
      lockedBy: null,
      lockedUntil: null,
      postId: extra.postId ?? undefined,
      lastError: extra.lastError ?? null,
      judgeVerdict: extra.judgeVerdict ?? undefined,
      updatedAt: now,
    })
    .where(eq(contentPlanItem.id, id));
}

export interface SweepResult {
  reclaimed: number;
  exhausted: number;
  /** Items that hit MAX_ATTEMPTS this sweep — worth alerting on. */
  exhaustedIds: string[];
}

/**
 * Reclaim items abandoned by a crashed or redeployed run.
 *
 * Without this the pipeline stops silently: a run killed mid-flight (Render
 * replacing the instance during a deploy is the normal case) leaves its row
 * at status='running' with a stale `locked_until`, and nothing else will ever
 * touch it. The blog just goes quiet.
 *
 * Runs at the top of every cron tick, before the claim.
 */
export async function sweepStaleLocks(
  now: Date = new Date(),
): Promise<SweepResult> {
  const db = getDb();

  const stale = await db
    .select({ id: contentPlanItem.id, attempts: contentPlanItem.attempts })
    .from(contentPlanItem)
    .where(
      and(
        eq(contentPlanItem.status, "running"),
        lt(contentPlanItem.lockedUntil, now),
      ),
    );

  if (stale.length === 0) {
    return { reclaimed: 0, exhausted: 0, exhaustedIds: [] };
  }

  // An item that has already burned MAX_ATTEMPTS is not retried again — it is
  // parked as failed so a poisonous topic cannot loop forever, quietly
  // consuming a deep-research call every tick.
  const exhaustedIds = stale.filter((s) => s.attempts >= MAX_ATTEMPTS).map((s) => s.id);
  const retryIds = stale.filter((s) => s.attempts < MAX_ATTEMPTS).map((s) => s.id);

  if (retryIds.length > 0) {
    await db
      .update(contentPlanItem)
      .set({
        status: "pending",
        lockedBy: null,
        lockedUntil: null,
        lastError: "Reclaimed after a run was abandoned mid-flight.",
        updatedAt: now,
      })
      .where(inArray(contentPlanItem.id, retryIds));
  }

  if (exhaustedIds.length > 0) {
    await db
      .update(contentPlanItem)
      .set({
        status: "failed",
        lockedBy: null,
        lockedUntil: null,
        lastError: `Abandoned ${MAX_ATTEMPTS} times without completing.`,
        updatedAt: now,
      })
      .where(inArray(contentPlanItem.id, exhaustedIds));
  }

  return {
    reclaimed: retryIds.length,
    exhausted: exhaustedIds.length,
    exhaustedIds,
  };
}

/** Pending items left, used to decide when to refill the queue. */
export async function pendingCount(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contentPlanItem)
    .where(eq(contentPlanItem.status, "pending"));
  return rows[0]?.n ?? 0;
}
