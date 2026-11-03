// The X Article queue: the ONLY writer of x_article_publication (migration 0046).
//
// X has no edit, delete or get call for Articles, so a wrong row cannot be
// corrected on X. Every transition is therefore one conditional UPDATE, and a
// worker's writes are fenced by `id AND claimed_by = me AND status = expected`:
// zero rows means the worker lost the row (its lease expired and recoverStale or
// another claim replaced it), so it stops the item and writes nothing else. A
// lost fence is a normal answer, never an exception. The table's CHECKs are the
// second line: a write that would make an impossible row throws.
//
//   queued -> working -> drafted -> publishing -> published        (terminal)
//                 |          '--> draft_only                       (terminal)
//                 '-- release -> queued / drafted
//   any -> skipped (post no longer public) | needs_attention (a person looks)
//
//   function        from -> to                       effect
//   enqueueDue      none -> queued                   sweep of public posts from the last 24 h
//   claimBatch      queued -> working                one UPDATE sets status, claimed_by, claimed_until
//                   drafted -> publishing            (drafted only in Publish mode)
//   saveDraft       working -> working               article_id, cover_status
//   markDraftOnly   working -> draft_only            terminal, lease cleared
//   beginPublishing working -> publishing            post must still be public, in the same statement
//   markPublished   publishing -> published          x_post_id, terminal
//   release         working -> queued | drafted       backoff; publishing -> drafted (429)
//   markAttention   working | publishing -> needs_attention
//   markSkipped     working -> skipped
//   recoverStale    working -> queued (attempts + 1, needs_attention at 3)
//                   publishing -> needs_attention     ALWAYS: the publish may have gone through
//                   queued | drafted older than 24 h -> needs_attention (stale)
//
// attempts counts runs that died holding the row, plus drafts X refused with a
// 503 (release with countsAttempt), because a deterministic 503 burns one of X's
// 10 daily draft calls each time. Other transient X failures do not count.
//
// Fence races are proven sequentially in queue.test.ts (pglite is one
// connection) and concurrently in tests/real-pg/x-article-queue.real-pg.test.ts.

import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { DB } from "../db";
import { xArticlePublication as xap } from "../db/schema";
import { PUBLIC_LISTED_FILTER } from "../posts";

export type CoverStatus = "none" | "uploaded" | "failed";

/** Why a person must look (needs_attention). `post_not_public` is the reason on a skipped row. */
export type AttentionReason =
  | "converter_refused" //  the post body uses markup the converter will not send
  | "x_auth" //             X rejected the keys (401 or 403)
  | "x_rejected" //         X refused the request (another 4xx, spending cap)
  | "publish_ambiguous" //  the publish call may have gone through
  | "attempts_exhausted" // the run died, or X refused the draft, 3 times
  | "stale"; //             older than 24 h before it could be posted

export interface ClaimedRow {
  id: string;
  postId: string;
  /** This claim's token. Every write below is conditional on it. */
  claimedBy: string;
  /** What the row became: working (a queued row) or publishing (a drafted row). */
  status: "working" | "publishing";
  attempts: number;
  /** Set when a draft already exists on X: the draft call is skipped. */
  articleId: string | null;
  coverStatus: CoverStatus;
  createdAt: Date;
}

export type Claim = Pick<ClaimedRow, "id" | "claimedBy">;

// postgres-js returns the rows as an array; pglite (tests) returns { rows }.
function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : (res as { rows: T[] }).rows;
}

const MAX_ATTEMPTS = 3;
const MAX_DETAIL = 500;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const NO_LEASE = { claimedBy: null, claimedUntil: null };

/**
 * Queue every public, listed post published in the last 24 h that has no row.
 * Idempotent (ON CONFLICT on the unique post_id). Returns how many were added.
 */
export async function enqueueDue(db: DB, now: Date): Promise<number> {
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const res = await db.execute(sql`
    INSERT INTO x_article_publication (post_id, next_attempt_at, created_at, updated_at)
    SELECT "post"."id", ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${nowIso}::timestamptz FROM "post"
    WHERE ${PUBLIC_LISTED_FILTER} AND "post"."published_at" >= ${since}::timestamptz
    ON CONFLICT (post_id) DO NOTHING
    RETURNING id`);
  return rowsOf(res).length;
}

/**
 * Take up to `limit` due rows, oldest first: queued rows become working, drafted
 * rows become publishing (only when `claimDrafted`, i.e. Publish mode). Rows another
 * worker holds are skipped, never waited for. Empty means nothing is due.
 */
export async function claimBatch(
  db: DB,
  opts: { now: Date; leaseMs: number; limit: number; claimDrafted: boolean },
): Promise<ClaimedRow[]> {
  const { now, leaseMs, limit, claimDrafted } = opts;
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: xap.id })
      .from(xap)
      .where(
        and(lte(xap.nextAttemptAt, now), inArray(xap.status, claimDrafted ? ["queued", "drafted"] : ["queued"])),
      )
      .orderBy(asc(xap.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];

    const claimed = await tx
      .update(xap)
      .set({
        status: sql`CASE ${xap.status} WHEN 'queued' THEN 'working' ELSE 'publishing' END`,
        claimedBy: sql`gen_random_uuid()`,
        claimedUntil: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      })
      .where(
        inArray(
          xap.id,
          due.map((r) => r.id),
        ),
      )
      .returning({
        id: xap.id,
        postId: xap.postId,
        claimedBy: xap.claimedBy,
        status: xap.status,
        attempts: xap.attempts,
        articleId: xap.articleId,
        coverStatus: xap.coverStatus,
        createdAt: xap.createdAt,
      });
    return claimed
      .map((r) => ({
        ...r,
        claimedBy: r.claimedBy as string,
        status: r.status as ClaimedRow["status"],
        coverStatus: r.coverStatus as CoverStatus,
      }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  });
}

// One fenced UPDATE. True means applied; false means this worker no longer holds the row.
async function fenced(
  db: DB,
  claim: Claim,
  from: string[],
  set: Partial<typeof xap.$inferInsert>,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(xap)
    .set({ ...set, updatedAt: now })
    .where(and(eq(xap.id, claim.id), eq(xap.claimedBy, claim.claimedBy), inArray(xap.status, from)))
    .returning({ id: xap.id });
  return rows.length === 1;
}

/** Record the draft X made. The row stays working. False means the fence was lost. */
export const saveDraft = (
  db: DB,
  claim: Claim,
  draft: { articleId: string; coverStatus: CoverStatus },
  now: Date,
) => fenced(db, claim, ["working"], draft, now);

/** Draft mode ends here: the draft stays in X and is never promoted. Needs an article id (the table enforces it). */
export const markDraftOnly = (db: DB, claim: Claim, now: Date) =>
  fenced(db, claim, ["working"], { status: "draft_only", ...NO_LEASE }, now);

/**
 * Last step before the publish call: working -> publishing, lease renewed, and the
 * post must STILL be public in the same statement. "ineligible" means this worker
 * still holds the row but the post was withdrawn (mark it skipped); "lost" means it
 * does not hold the row.
 */
export async function beginPublishing(
  db: DB,
  claim: Claim,
  opts: { now: Date; leaseMs: number },
): Promise<"ok" | "lost" | "ineligible"> {
  const { now, leaseMs } = opts;
  const holds = and(eq(xap.id, claim.id), eq(xap.claimedBy, claim.claimedBy), eq(xap.status, "working"));
  const rows = await db
    .update(xap)
    .set({ status: "publishing", claimedUntil: new Date(now.getTime() + leaseMs), updatedAt: now })
    .where(
      and(holds, sql`EXISTS (SELECT 1 FROM "post" WHERE "post"."id" = ${xap.postId} AND ${PUBLIC_LISTED_FILTER})`),
    )
    .returning({ id: xap.id });
  if (rows.length === 1) return "ok";
  // Zero rows is either a lost fence or a withdrawn post; the same fence read back tells which.
  const held = await db.select({ id: xap.id }).from(xap).where(holds).limit(1);
  return held.length === 1 ? "ineligible" : "lost";
}

/** The publish call returned a post id. Terminal. */
export const markPublished = (db: DB, claim: Claim, xPostId: string, now: Date) =>
  fenced(db, claim, ["publishing"], { status: "published", xPostId, ...NO_LEASE }, now);

/** Terminal failure: a person must look. The detail is X's status and error code, never article text. */
export const markAttention = (db: DB, claim: Claim, reason: AttentionReason, detail: string, now: Date) =>
  fenced(
    db,
    claim,
    ["working", "publishing"],
    { status: "needs_attention", attentionReason: reason, attentionDetail: detail.slice(0, MAX_DETAIL), ...NO_LEASE },
    now,
  );

/** The post is no longer public, so it is not posted. Terminal. */
export const markSkipped = (db: DB, claim: Claim, now: Date) =>
  fenced(db, claim, ["working"], { status: "skipped", attentionReason: "post_not_public", ...NO_LEASE }, now);

/**
 * Give the row back for a later try: working -> queued (no draft yet) or drafted,
 * publishing -> drafted (a 429). The next try waits a quarter of the row's age, at
 * least 1 minute and at most 60, or X's Retry-After if that is longer.
 * `countsAttempt` is for X refusing a draft with a 503; the third counted attempt
 * ends in needs_attention (attempts_exhausted) instead.
 */
export async function release(
  db: DB,
  claim: Claim,
  opts: { now: Date; countsAttempt: boolean; retryAfterMs?: number },
): Promise<boolean> {
  const { now, countsAttempt, retryAfterMs = 0 } = opts;
  const nowIso = now.toISOString();
  const exhausted = countsAttempt ? sql`${xap.attempts} + 1 >= ${MAX_ATTEMPTS}` : sql`false`;
  const backoff = sql`LEAST(GREATEST((${nowIso}::timestamptz - ${xap.createdAt}) / 4, interval '1 minute'), interval '60 minutes')`;
  const rows = await db
    .update(xap)
    .set({
      status: sql`CASE WHEN ${exhausted} THEN 'needs_attention' WHEN ${xap.articleId} IS NULL THEN 'queued' ELSE 'drafted' END`,
      ...(countsAttempt && { attempts: sql`${xap.attempts} + 1` }),
      nextAttemptAt: sql`${nowIso}::timestamptz + GREATEST(${backoff}, ${retryAfterMs} * interval '1 millisecond')`,
      attentionReason: sql`CASE WHEN ${exhausted} THEN 'attempts_exhausted' END`,
      attentionDetail: sql`CASE WHEN ${exhausted} THEN ${`X refused the draft ${MAX_ATTEMPTS} times`} END`,
      ...NO_LEASE,
      updatedAt: now,
    })
    .where(and(eq(xap.id, claim.id), eq(xap.claimedBy, claim.claimedBy), inArray(xap.status, ["working", "publishing"])))
    .returning({ id: xap.id });
  return rows.length === 1;
}

/**
 * Every tick: rows whose lease expired, and rows too old to post. A publishing row
 * whose lease expired ALWAYS goes to needs_attention (the publish may have gone
 * through, and X has no way to check or undo it), never back to the queue.
 */
export async function recoverStale(
  db: DB,
  now: Date,
): Promise<{ requeued: number; ambiguous: number; exhausted: number; stale: number }> {
  return db.transaction(async (tx) => {
    const expired = lt(xap.claimedUntil, now);
    const ambiguous = await tx
      .update(xap)
      .set({
        status: "needs_attention",
        attentionReason: "publish_ambiguous",
        attentionDetail: "the publish call may have gone through; check x.com before retrying",
        ...NO_LEASE,
        updatedAt: now,
      })
      .where(and(eq(xap.status, "publishing"), expired))
      .returning({ id: xap.id });
    const exhausted = await tx
      .update(xap)
      .set({
        status: "needs_attention",
        attentionReason: "attempts_exhausted",
        attentionDetail: `the run died ${MAX_ATTEMPTS} times`,
        attempts: sql`${xap.attempts} + 1`,
        ...NO_LEASE,
        updatedAt: now,
      })
      .where(and(eq(xap.status, "working"), expired, sql`${xap.attempts} + 1 >= ${MAX_ATTEMPTS}`))
      .returning({ id: xap.id });
    const requeued = await tx
      .update(xap)
      .set({ status: "queued", attempts: sql`${xap.attempts} + 1`, ...NO_LEASE, updatedAt: now })
      .where(and(eq(xap.status, "working"), expired))
      .returning({ id: xap.id });
    const stale = await tx
      .update(xap)
      .set({
        status: "needs_attention",
        attentionReason: "stale",
        attentionDetail: "older than 24 hours before it could be posted",
        updatedAt: now,
      })
      .where(and(inArray(xap.status, ["queued", "drafted"]), lt(xap.createdAt, new Date(now.getTime() - WINDOW_MS))))
      .returning({ id: xap.id });
    return {
      requeued: requeued.length,
      ambiguous: ambiguous.length,
      exhausted: exhausted.length,
      stale: stale.length,
    };
  });
}
