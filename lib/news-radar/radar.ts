import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import {
  newsCandidate,
  newsRadarRubric,
  newsRadarTick,
  siteSetting,
} from "../db/schema";
import { getIntegrationConfig } from "../integration-config";
import { findSimilarPosts } from "../posts/find-similar";
import {
  JevAuthError,
  JevOverloadedError,
  JevRateLimitError,
  scoreCandidate as defaultScoreCandidate,
} from "./curator";
import { fetchFeed as defaultFetchFeed } from "./feed";
import { parseRubricConfig, type RubricConfig } from "./rubric";

// One radar tick: read the feed, store new items, score what is waiting, log the
// tick. Plan: ceo-plans/2026-10-25-blog-pipeline-rebuild-plan.md (ENG-D3, D6, D9,
// D10, outside-voice F3).
//
// Guarantees, each proven in radar.test.ts against real Postgres (pglite):
//   - the rubric version is pinned once per tick and written on every score row;
//   - work is picked from the database, not the feed, so an item that has left the
//     feed is still scored, and a claim whose owner stalled is taken over;
//   - every score write is ONE statement whose UPDATE is the ownership gate (a
//     stale tick whose claim was reclaimed changes nothing);
//   - the cron never writes a label;
//   - a tick that finishes writes one news_radar_tick row; a tick that throws
//     writes none, which is how a missed slot shows up.

// Tunable constants, [estimated] defaults; Release 1 keeps them in code.
const BATCH_LIMIT = 25;
// Far longer than one item takes (10 s Jev timeout), so a live tick never loses
// its claim; short enough that a crashed tick's items come back within a tick.
const CLAIM_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
// Render cuts a request that runs too long; stop picking up items before that.
const TIME_BUDGET_MS = 50_000;
// Jev answering badly several items in a row means the service is down: stop
// instead of burning the budget on timeouts.
const CONSECUTIVE_FAILURE_LIMIT = 3;
// Score-row model label for the novelty measurement (nearest published post).
const NOVELTY_MODEL = "embedding-nearest-post";
// Cosine distance is 0 to 2; an empty corpus makes every item maximally novel.
const MAX_DISTANCE = 2;
const FLAG_KEY = "news_radar_enabled";

export type TickOutcome = "ok" | "partial" | "failed" | "disabled";

export interface TickResult {
  outcome: TickOutcome;
  fetched: number;
  newCount: number;
  scored: number;
  unscored: number;
  failedCount: number;
  errorClass: string | null;
  rubricVersion: number | null;
}

export interface TickDeps {
  db?: DB;
  isEnabled?: (db: DB) => Promise<boolean>;
  getApiKey?: () => Promise<string | null>;
  fetchFeed?: typeof defaultFetchFeed;
  scoreCandidate?: typeof defaultScoreCandidate;
  /** Nearest published post's cosine distance, or null when it cannot be measured. */
  novelty?: (item: { title: string; summary: string }) => Promise<number | null>;
  now?: () => Date;
  newToken?: () => string;
  batchLimit?: number;
  budgetMs?: number;
}

export interface ClaimedCandidate {
  id: string;
  title: string;
  summary: string;
  category: string | null;
  attempts: number;
}

interface ScoreRow {
  questionKey: string;
  model: string;
  score: number;
  confidence: number | null;
  probabilities: Record<string, number> | null;
}

export async function isNewsRadarEnabled(db: DB): Promise<boolean> {
  const rows = await db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, FLAG_KEY))
    .limit(1);
  const stored = rows[0]?.value as { enabled?: unknown } | undefined;
  return stored?.enabled === true;
}

async function defaultGetApiKey(): Promise<string | null> {
  return (await getIntegrationConfig()).typesafeApiKey ?? null;
}

async function defaultNovelty(item: {
  title: string;
  summary: string;
}): Promise<number | null> {
  try {
    const rows = await findSimilarPosts({
      queryText: { title: item.title, excerpt: item.summary },
      limit: 1,
      visibility: "public",
    });
    return rows[0]?.distance ?? MAX_DISTANCE;
  } catch {
    // Embedding down or key missing: the item is scored without novelty and is
    // simply not eligible; the page shows "novelty unavailable".
    return null;
  }
}

export async function runTick(
  slotAt: Date,
  deps: TickDeps = {},
): Promise<TickResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const result: TickResult = {
    outcome: "ok",
    fetched: 0,
    newCount: 0,
    scored: 0,
    unscored: 0,
    failedCount: 0,
    errorClass: null,
    rubricVersion: null,
  };

  const finish = async (outcome: TickOutcome, errorClass: string | null) => {
    result.outcome = outcome;
    result.errorClass = errorClass;
    await logTick(db, slotAt, startedAt, now(), result);
    return result;
  };

  if (!(await (deps.isEnabled ?? isNewsRadarEnabled)(db))) {
    return finish("disabled", null);
  }

  // Pin the rubric once. A version added while this tick runs does not apply to it.
  const rubricRow = (
    await db
      .select({ version: newsRadarRubric.version, config: newsRadarRubric.config })
      .from(newsRadarRubric)
      .orderBy(desc(newsRadarRubric.version))
      .limit(1)
  )[0];
  if (!rubricRow) return finish("failed", "NoRubric");
  let rubric: RubricConfig;
  try {
    rubric = parseRubricConfig(rubricRow.config);
  } catch {
    return finish("failed", "RubricInvalid");
  }
  result.rubricVersion = rubricRow.version;

  const apiKey = await (deps.getApiKey ?? defaultGetApiKey)();
  if (!apiKey) return finish("failed", "JevKeyMissing");

  // Feed trouble fails the tick but does not stop it: waiting items still get
  // scored. Only the fetch is caught; a database error while storing must crash.
  let feedError: string | null = null;
  let feed: Awaited<ReturnType<typeof defaultFetchFeed>> | null = null;
  try {
    feed = await (deps.fetchFeed ?? defaultFetchFeed)();
  } catch (err) {
    feedError = err instanceof Error ? err.name : "FeedError";
  }
  if (feed) {
    result.fetched = feed.entries.length;
    result.newCount = await storeEntries(db, feed.entries);
  }

  const token = (deps.newToken ?? (() => crypto.randomUUID()))();
  const claimed = await claimBatch(db, token, now(), deps.batchLimit ?? BATCH_LIMIT);
  const score = deps.scoreCandidate ?? defaultScoreCandidate;
  const novelty = deps.novelty ?? defaultNovelty;
  const budgetMs = deps.budgetMs ?? TIME_BUDGET_MS;

  let consecutiveFailures = 0;
  let stopReason: string | null = null;
  for (let i = 0; i < claimed.length; i++) {
    const item = claimed[i];
    if (now().getTime() - startedAt.getTime() > budgetMs) {
      await releaseUntried(db, claimed.slice(i), token, now());
      break;
    }

    const distance = await novelty({ title: item.title, summary: item.summary });
    let rows: ScoreRow[];
    try {
      const scored = await score(item, rubric, apiKey);
      rows = scored.answers.map((a) => ({
        questionKey: a.questionKey,
        model: a.model,
        score: a.score,
        confidence: a.confidence,
        probabilities: a.probabilities,
      }));
      if (distance !== null) {
        rows.push({
          questionKey: "novelty",
          model: NOVELTY_MODEL,
          score: distance,
          confidence: null,
          probabilities: null,
        });
      }
    } catch (err) {
      if (!(err instanceof Error) || !err.name.startsWith("Jev")) throw err;
      if (err instanceof JevAuthError) {
        // The key is wrong: nothing else will work this tick. Fail closed.
        await releaseUntried(db, claimed.slice(i), token, now());
        return finish("failed", err.name);
      }
      if (err instanceof JevRateLimitError || err instanceof JevOverloadedError) {
        // Retries are exhausted inside the curator; stop and leave the rest for the next tick.
        await releaseUntried(db, claimed.slice(i), token, now());
        stopReason = err.name;
        break;
      }
      const status = item.attempts >= MAX_ATTEMPTS ? "failed" : "unscored";
      if (await settleFailure(db, item.id, token, status, err.name, now())) {
        if (status === "failed") result.failedCount++;
        else result.unscored++;
      }
      consecutiveFailures++;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        await releaseUntried(db, claimed.slice(i + 1), token, now());
        stopReason = err.name;
        break;
      }
      continue;
    }

    consecutiveFailures = 0;
    // A stale tick (claim taken over) commits nothing and counts nothing.
    if (await commitScores(db, item.id, token, rubricRow.version, rows, now())) {
      result.scored++;
    }
  }

  if (feedError) return finish("failed", feedError);
  const degraded =
    result.unscored > 0 || result.failedCount > 0 || stopReason !== null;
  return finish(degraded ? "partial" : "ok", stopReason);
}

async function storeEntries(
  db: DB,
  entries: { sourceUrl: string; title: string; summary: string; category: string | null; publishedAt: Date }[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const inserted = await db
    .insert(newsCandidate)
    .values(entries)
    .onConflictDoNothing({ target: newsCandidate.sourceUrl })
    .returning({ id: newsCandidate.id });
  return inserted.length;
}

/**
 * Claim up to `limit` items in one transaction: lock with SKIP LOCKED so a
 * concurrent tick takes different rows, then mark them scoring under `token`.
 * Items that already used every attempt are retired as failed first, so a
 * crash-looping item cannot be reclaimed forever. Mirrors lib/scheduler.ts.
 */
export async function claimBatch(
  db: DB,
  token: string,
  now: Date,
  limit: number = BATCH_LIMIT,
): Promise<ClaimedCandidate[]> {
  const needsWork = or(
    inArray(newsCandidate.status, ["new", "unscored"]),
    and(eq(newsCandidate.status, "scoring"), lt(newsCandidate.claimedUntil, now)),
  );
  return db.transaction(async (tx) => {
    await tx
      .update(newsCandidate)
      .set({
        status: "failed",
        claimedBy: null,
        claimedUntil: null,
        lastError: "AttemptLimit",
        updatedAt: now,
      })
      .where(and(needsWork, gte(newsCandidate.attempts, MAX_ATTEMPTS)));

    const rows = await tx
      .select({ id: newsCandidate.id })
      .from(newsCandidate)
      .where(needsWork)
      .orderBy(asc(newsCandidate.firstSeenAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return [];

    return tx
      .update(newsCandidate)
      .set({
        status: "scoring",
        claimedBy: token,
        claimedUntil: new Date(now.getTime() + CLAIM_MS),
        attempts: sql`${newsCandidate.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        inArray(
          newsCandidate.id,
          rows.map((r) => r.id),
        ),
      )
      .returning({
        id: newsCandidate.id,
        title: newsCandidate.title,
        summary: newsCandidate.summary,
        category: newsCandidate.category,
        attempts: newsCandidate.attempts,
      });
  });
}

/**
 * All of an item's score rows for one rubric version, written in ONE statement.
 * The UPDATE locks the row and re-checks the owner against the latest committed
 * version, and the INSERT reads only what the UPDATE returned, so a tick whose
 * claim was taken over gets zero rows and writes nothing.
 */
async function commitScores(
  db: DB,
  id: string,
  token: string,
  version: number,
  rows: ScoreRow[],
  now: Date,
): Promise<boolean> {
  // Raw sql: postgres-js cannot bind a JS Date here (pglite can, which is how this
  // slipped past the tests and was caught by the live DEV run), so pass ISO text.
  const values = rows.map(
    (r) =>
      sql`(${r.questionKey}::text, ${r.model}::text, ${r.score}::double precision, ${r.confidence}::double precision, ${r.probabilities === null ? null : JSON.stringify(r.probabilities)}::jsonb)`,
  );
  const res = await db.execute(sql`
    WITH won AS (
      UPDATE news_candidate
         SET status = 'scored', claimed_by = NULL, claimed_until = NULL, last_error = NULL, updated_at = ${now.toISOString()}::timestamptz
       WHERE id = ${id}::uuid AND claimed_by = ${token}::uuid AND status = 'scoring'
       RETURNING id)
    INSERT INTO news_candidate_score (candidate_id, rubric_version, question_key, model, score, confidence, probabilities)
    SELECT won.id, ${version}::integer, v.question_key, v.model, v.score, v.confidence, v.probabilities
      FROM won CROSS JOIN (VALUES ${sql.join(values, sql`, `)}) AS v(question_key, model, score, confidence, probabilities)
    RETURNING candidate_id`);
  return rowCount(res) > 0;
}

// postgres-js returns the rows as an array; pglite (tests) returns { rows }.
function rowCount(res: unknown): number {
  if (Array.isArray(res)) return res.length;
  return (res as { rows: unknown[] }).rows.length;
}

async function settleFailure(
  db: DB,
  id: string,
  token: string,
  status: "unscored" | "failed",
  errorClass: string,
  now: Date,
): Promise<boolean> {
  const done = await db
    .update(newsCandidate)
    .set({ status, claimedBy: null, claimedUntil: null, lastError: errorClass, updatedAt: now })
    .where(
      and(
        eq(newsCandidate.id, id),
        eq(newsCandidate.claimedBy, token),
        eq(newsCandidate.status, "scoring"),
      ),
    )
    .returning({ id: newsCandidate.id });
  return done.length > 0;
}

/**
 * Give back claimed items this tick never tried (budget spent, or the tick
 * stopped). The attempt claimed for them is refunded: not the item's fault.
 */
async function releaseUntried(
  db: DB,
  items: ClaimedCandidate[],
  token: string,
  now: Date,
): Promise<void> {
  if (items.length === 0) return;
  await db
    .update(newsCandidate)
    .set({
      status: sql`CASE WHEN ${newsCandidate.attempts} <= 1 THEN 'new' ELSE 'unscored' END`,
      claimedBy: null,
      claimedUntil: null,
      attempts: sql`GREATEST(${newsCandidate.attempts} - 1, 0)`,
      updatedAt: now,
    })
    .where(
      and(
        inArray(
          newsCandidate.id,
          items.map((i) => i.id),
        ),
        eq(newsCandidate.claimedBy, token),
        eq(newsCandidate.status, "scoring"),
      ),
    );
}

/**
 * One row per finished tick. A retry of the same slot may replace a failed or
 * disabled row but never downgrades an ok or partial one.
 */
async function logTick(
  db: DB,
  slotAt: Date,
  startedAt: Date,
  finishedAt: Date,
  r: TickResult,
): Promise<void> {
  const row = {
    slotAt,
    startedAt,
    finishedAt,
    outcome: r.outcome,
    fetched: r.fetched,
    newCount: r.newCount,
    scored: r.scored,
    unscored: r.unscored,
    failedCount: r.failedCount,
    errorClass: r.errorClass,
    rubricVersion: r.rubricVersion,
  };
  await db
    .insert(newsRadarTick)
    .values(row)
    .onConflictDoUpdate({
      target: newsRadarTick.slotAt,
      set: { ...row, updatedAt: finishedAt },
      setWhere: sql`${newsRadarTick.outcome} NOT IN ('ok', 'partial')`,
    });
}
