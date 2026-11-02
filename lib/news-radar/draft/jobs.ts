// The drafting queue: one job per Kept story, one run at a time, a lease so a dead
// process cannot hold a job forever, and a daily cap counted in Melbourne days.
//
// A job that loses its process restarts from its first stage (see migration 0043);
// nothing here resumes mid-way. Every write that finishes or renews a job is
// guarded by the run's own random token, so a run that was replaced cannot commit
// over the run that replaced it. That guarantee is proven sequentially in the tests
// (pglite is single-connection), the way the radar's claim guard is.

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import type { DB } from "../../db";
import { newsCandidate, newsDraftJob, newsDraftStep } from "../../db/schema";

/** Why a person must look (needs_attention) or the machinery gave up (failed). */
export type AttentionReason =
  | "no_sources_found" //   the search found nothing usable to fetch
  | "sources_unreachable" // sources were found but none could be fetched
  | "no_primary_source" //   pages came back but none is a primary document
  | "unverified_quotes" //   the research brief quotes something the sources do not say
  | "failed_gates" //        the essay still breaks a check after the allowed rewrites
  | "slop_verdict" //        the judge still calls it slop after the allowed rewrites
  | "judge_failed" //        the judge's answer could not be read
  | "model_error" //         a model call kept failing
  | "missing_setup" //       a skill, the category or the author is not there
  | "lease_expired" //       the process died too many times
  | "crashed"; //            an unexpected error

export interface ClaimedJob {
  id: string;
  candidateId: string;
  /** This run's token. Every finishing write is conditional on it. */
  claimedBy: string;
  attempts: number;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: Date;
}

// postgres-js returns the rows as an array; pglite (tests) returns { rows }.
function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : (res as { rows: T[] }).rows;
}

const MAX_DETAIL = 500;
const MELBOURNE = "Australia/Melbourne";

/**
 * Queue a job for every story whose LATEST label is keep and that has none yet.
 * Idempotent. Returns how many were added.
 */
export async function enqueueKept(db: DB): Promise<number> {
  const res = await db.execute(sql`
    INSERT INTO news_draft_job (candidate_id)
    SELECT c.id FROM news_candidate c
    WHERE (SELECT l.decision FROM news_candidate_label l WHERE l.candidate_id = c.id ORDER BY l.sequence DESC LIMIT 1) = 'keep'
    ON CONFLICT (candidate_id) DO NOTHING
    RETURNING id`);
  return rowsOf(res).length;
}

/** Jobs that STARTED on the Melbourne day `now` falls in. A restart keeps its first started_at. */
export async function countStartedToday(db: Pick<DB, "execute">, now: Date): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM news_draft_job
    WHERE started_at IS NOT NULL
      AND (started_at AT TIME ZONE ${MELBOURNE})::date = (${now.toISOString()}::timestamptz AT TIME ZONE ${MELBOURNE})::date`);
  return Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0);
}

async function stillKept(db: Pick<DB, "execute">, candidateId: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT decision FROM news_candidate_label WHERE candidate_id = ${candidateId} ORDER BY sequence DESC LIMIT 1`);
  return rowsOf<{ decision: string }>(res)[0]?.decision === "keep";
}

/**
 * Take the next queued job, if one may run now: no other run holds a live lease
 * and the Melbourne-day cap is not spent. A queued job whose story is no longer
 * Kept is cancelled instead of drafted.
 */
export async function claimNext(
  db: DB,
  opts: { now: Date; leaseMs: number; cap: number },
): Promise<ClaimedJob | null> {
  const { now, leaseMs, cap } = opts;
  return db.transaction(async (tx) => {
    const live = await tx
      .select({ id: newsDraftJob.id })
      .from(newsDraftJob)
      .where(and(eq(newsDraftJob.status, "running"), gt(newsDraftJob.claimedUntil, now)))
      .limit(1);
    if (live.length > 0) return null;
    if ((await countStartedToday(tx, now)) >= cap) return null;

    // Bounded: each pass either claims a job or cancels one that was un-Kept.
    for (let pass = 0; pass < 20; pass++) {
      const [row] = await tx
        .select({
          id: newsDraftJob.id,
          candidateId: newsDraftJob.candidateId,
          title: newsCandidate.title,
          summary: newsCandidate.summary,
          sourceUrl: newsCandidate.sourceUrl,
          publishedAt: newsCandidate.publishedAt,
        })
        .from(newsDraftJob)
        .innerJoin(newsCandidate, eq(newsCandidate.id, newsDraftJob.candidateId))
        .where(eq(newsDraftJob.status, "queued"))
        .orderBy(asc(newsDraftJob.createdAt))
        .limit(1)
        .for("update", { of: newsDraftJob, skipLocked: true });
      if (!row) return null;

      if (!(await stillKept(tx, row.candidateId))) {
        await tx
          .update(newsDraftJob)
          .set({ status: "cancelled", finishedAt: now, updatedAt: now })
          .where(eq(newsDraftJob.id, row.id));
        continue;
      }

      const claimedBy = randomUUID();
      const [claimed] = await tx
        .update(newsDraftJob)
        .set({
          status: "running",
          claimedBy,
          claimedUntil: new Date(now.getTime() + leaseMs),
          attempts: sql`${newsDraftJob.attempts} + 1`,
          startedAt: sql`coalesce(${newsDraftJob.startedAt}, ${now.toISOString()}::timestamptz)`,
          updatedAt: now,
        })
        .where(eq(newsDraftJob.id, row.id))
        .returning({ attempts: newsDraftJob.attempts });
      return { ...row, claimedBy, attempts: claimed.attempts };
    }
    return null;
  });
}

/** Push the lease out. False means this run no longer holds the job and must stop. */
export async function renewLease(db: DB, job: ClaimedJob, now: Date, leaseMs: number): Promise<boolean> {
  const rows = await db
    .update(newsDraftJob)
    .set({ claimedUntil: new Date(now.getTime() + leaseMs), updatedAt: now })
    .where(and(eq(newsDraftJob.id, job.id), eq(newsDraftJob.claimedBy, job.claimedBy), eq(newsDraftJob.status, "running")))
    .returning({ id: newsDraftJob.id });
  return rows.length === 1;
}

async function finish(
  db: DB,
  job: ClaimedJob,
  now: Date,
  set: Partial<typeof newsDraftJob.$inferInsert>,
): Promise<boolean> {
  const rows = await db
    .update(newsDraftJob)
    .set({ ...set, claimedBy: null, claimedUntil: null, finishedAt: now, updatedAt: now })
    .where(and(eq(newsDraftJob.id, job.id), eq(newsDraftJob.claimedBy, job.claimedBy), eq(newsDraftJob.status, "running")))
    .returning({ id: newsDraftJob.id });
  return rows.length === 1;
}

export const finishSucceeded = (db: DB, job: ClaimedJob, postId: string, now: Date) =>
  finish(db, job, now, { status: "succeeded", postId });

export const finishNeedsAttention = (db: DB, job: ClaimedJob, reason: AttentionReason, detail: string, now: Date) =>
  finish(db, job, now, { status: "needs_attention", attentionReason: reason, attentionDetail: detail.slice(0, MAX_DETAIL) });

export const finishFailed = (db: DB, job: ClaimedJob, reason: AttentionReason, detail: string, now: Date) =>
  finish(db, job, now, { status: "failed", attentionReason: reason, attentionDetail: detail.slice(0, MAX_DETAIL) });

/** Give the job back for another try after an unexpected error. False if this run no longer holds it. */
export async function requeueJob(db: DB, job: ClaimedJob, now: Date): Promise<boolean> {
  const rows = await db
    .update(newsDraftJob)
    .set({ status: "queued", claimedBy: null, claimedUntil: null, updatedAt: now })
    .where(and(eq(newsDraftJob.id, job.id), eq(newsDraftJob.claimedBy, job.claimedBy), eq(newsDraftJob.status, "running")))
    .returning({ id: newsDraftJob.id });
  return rows.length === 1;
}

/** Posts the pipeline has made so far. The photo subject rotates on this. */
export async function countSucceeded(db: Pick<DB, "execute">): Promise<number> {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM news_draft_job WHERE status = 'succeeded'`);
  return Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0);
}

/**
 * Jobs whose lease expired: back in the queue if they have tries left, failed
 * (reason lease_expired) if not.
 */
export async function recoverStale(
  db: DB,
  now: Date,
  maxAttempts: number,
): Promise<{ requeued: number; failed: number }> {
  return db.transaction(async (tx) => {
    const expired = and(eq(newsDraftJob.status, "running"), lt(newsDraftJob.claimedUntil, now));
    const failed = await tx
      .update(newsDraftJob)
      .set({
        status: "failed",
        attentionReason: "lease_expired",
        attentionDetail: `the run died ${maxAttempts} times`,
        claimedBy: null,
        claimedUntil: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(expired, sql`${newsDraftJob.attempts} >= ${maxAttempts}`))
      .returning({ id: newsDraftJob.id });
    const requeued = await tx
      .update(newsDraftJob)
      .set({ status: "queued", claimedBy: null, claimedUntil: null, updatedAt: now })
      .where(expired)
      .returning({ id: newsDraftJob.id });
    return { requeued: requeued.length, failed: failed.length };
  });
}

export interface StepRecord {
  stepKey: string;
  attempt: number;
  status: "ok" | "failed";
  output: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
}

/** One finished stage. Recording the same stage twice for the same attempt replaces it. */
export async function recordStep(db: DB, jobId: string, step: StepRecord): Promise<void> {
  const values = {
    jobId,
    stepKey: step.stepKey,
    attempt: step.attempt,
    status: step.status,
    output: step.output,
    model: step.model,
    inputTokens: step.inputTokens,
    outputTokens: step.outputTokens,
    costUsd: step.costUsd === null ? null : step.costUsd.toFixed(6),
    durationMs: Math.max(0, Math.round(step.durationMs)),
  };
  await db
    .insert(newsDraftStep)
    .values(values)
    .onConflictDoUpdate({
      target: [newsDraftStep.jobId, newsDraftStep.stepKey, newsDraftStep.attempt],
      set: { ...values, updatedAt: new Date() },
    });
}
