import { and, eq } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { post } from "../db/schema";
import { getIntegrationConfig } from "../integration-config";
import type { IntegrationConfig } from "../integration-config-shared";
import { PUBLIC_LISTED_FILTER } from "../posts";
import { getSiteUrl } from "../site-config";
import { createDraft, getPost, publishDraft, uploadMedia, type XFailure, type XMeta } from "./client";
import { markdownToContentState } from "./content-state";
import { cropCoverTo52 } from "./cover";
import type { XCredentials } from "./oauth1";
import {
  beginPublishing,
  claimBatch,
  enqueueDue,
  markAttention,
  markDraftOnly,
  markPublished,
  markSkipped,
  recoverStale,
  release,
  saveDraft,
  type AttentionReason,
  type Claim,
  type ClaimedRow,
  type CoverStatus,
} from "./queue";

// One tick of the X Article phase, run by the process-scheduled-posts cron after
// the blog publisher. queue.ts owns every state change; this file owns the X work
// and decides, for each answer X gives, which transition follows.
//
//   Off      does nothing at all (no sweep, no claim, no call)
//   Draft    makes the Article as a draft on X and stops there (draft_only)
//   Publish  drafts, then publishes. Only when running on Render: DEV holds a
//            clone of PROD and X has no delete call, so anywhere else Publish
//            runs as Draft.
//
// Failure mapping:
//   401/403            needs_attention x_auth, and the tick stops
//   other 4xx          needs_attention x_rejected
//   429                back to the queue after Retry-After, and the tick stops
//   5xx on the draft   back to the queue and COUNTS an attempt: X answers a bare
//                      503 for content it dislikes, every try burns one of the 10
//                      daily draft calls, and the third ends in needs_attention
//   other transient    back to the queue, no attempt counted
//   publish sent but   needs_attention publish_ambiguous, never sent again
//   not confirmed
//   publish answered   needs_attention publish_ambiguous too: X has answered 200
//   ok, post not found with a post id that did not exist, so `published` is only
//                      recorded once a lookup finds the post
//
// X allows 10 draft calls and 5 publishes per 24 h per user and reports what is
// left on every answer; the tick stops draining at 2 drafts or 1 publish left.
// Nothing here logs a key, a header, an answer body, a title or post text.

const LEASE_MS = 120_000;
const BATCH = 3;
const TICK_WALL_MS = 55_000;
const CALL_TIMEOUT_MS = 15_000;
// A call given less than this would time out before X could answer; for a publish
// that would be a false "ambiguous", so the row waits for the next tick instead.
const MIN_CALL_MS = 5_000;
const DRAFT_RESERVE = 2;
const PUBLISH_RESERVE = 1;
const HOLD_MS = 60 * 60_000;
const MAX_COVER_BYTES = 5 * 1024 * 1024;

export type XMode = "off" | "draft" | "publish";
export type XRunConfig = Pick<
  IntegrationConfig,
  "xApiKey" | "xApiSecret" | "xAccessToken" | "xAccessTokenSecret" | "xArticlesMode"
>;

export interface XRunDeps {
  db?: DB;
  now?: () => Date;
  /** Used for X and for the cover fetch. Tests pass a fake so nothing reaches the network. */
  fetchImpl?: typeof fetch;
  readConfig?: () => Promise<XRunConfig>;
  siteUrl?: string;
}

export interface XRunSummary {
  mode: XMode;
  effectiveMode: XMode;
  swept: number;
  claimed: number;
  drafted: number;
  published: number;
  skipped: number;
  attention: number;
  released: number;
  stopped: Stop["reason"] | null;
}

type Stop = { reason: "auth" | "rate_limited" | "daily_limit" | "tick_wall"; holdMs: number };
const WALL: Stop = { reason: "tick_wall", holdMs: 0 };
const DAILY: Stop = { reason: "daily_limit", holdMs: HOLD_MS };

interface Ctx {
  db: DB;
  now: () => Date;
  fetchImpl: typeof fetch;
  creds: XCredentials;
  siteUrl: string;
  effectiveMode: "draft" | "publish";
  deadline: number;
  summary: XRunSummary;
}

export async function runXArticlesPhase(deps: XRunDeps = {}): Promise<XRunSummary> {
  const now = deps.now ?? (() => new Date());
  const config = await (deps.readConfig ?? getIntegrationConfig)();
  const mode = config.xArticlesMode;
  const summary: XRunSummary = {
    mode,
    effectiveMode: mode,
    swept: 0,
    claimed: 0,
    drafted: 0,
    published: 0,
    skipped: 0,
    attention: 0,
    released: 0,
    stopped: null,
  };
  if (mode === "off") return summary;

  const { xApiKey, xApiSecret, xAccessToken, xAccessTokenSecret } = config;
  if (!xApiKey || !xApiSecret || !xAccessToken || !xAccessTokenSecret) throw new Error("X keys incomplete");

  const effectiveMode = mode === "publish" && process.env.RENDER !== "true" ? "draft" : mode;
  summary.effectiveMode = effectiveMode;
  if (effectiveMode !== mode) console.warn("[x-articles] Publish mode is running as Draft: RENDER is not set");

  const db = deps.db ?? getDb();
  const c: Ctx = {
    db,
    now,
    fetchImpl: deps.fetchImpl ?? fetch,
    creds: { apiKey: xApiKey, apiSecret: xApiSecret, accessToken: xAccessToken, accessTokenSecret: xAccessTokenSecret },
    siteUrl: deps.siteUrl ?? getSiteUrl(),
    effectiveMode,
    deadline: now().getTime() + TICK_WALL_MS,
    summary,
  };

  await recoverStale(db, now());
  summary.swept = await enqueueDue(db, now());
  const rows = await claimBatch(db, { now: now(), leaseMs: LEASE_MS, limit: BATCH, claimDrafted: effectiveMode === "publish" });
  summary.claimed = rows.length;

  let stop: Stop | null = null;
  for (const row of rows) {
    // Once the tick must stop, what is left of the batch goes back untouched.
    if (stop) await putBack(c, row, stop.holdMs);
    else stop = await processRow(c, row);
  }
  summary.stopped = stop?.reason ?? null;
  if (summary.swept || summary.claimed) console.info(`[x-articles] tick ${JSON.stringify(summary)}`);
  return summary;
}

async function processRow(c: Ctx, row: ClaimedRow): Promise<Stop | null> {
  let articleId = row.articleId;
  let stop: Stop | null = null;

  if (row.status === "working") {
    const p = await loadPost(c, row.postId);
    if (!p) return skip(c, row);
    if (!articleId) {
      const made = await makeDraft(c, row, p);
      if (made.articleId === null) return made.stop;
      articleId = made.articleId;
      stop = made.stop;
    }
    if (c.effectiveMode === "draft") {
      if (await markDraftOnly(c.db, row, c.now())) c.summary.drafted++;
      return stop;
    }
    const begun = await beginPublishing(c.db, row, { now: c.now(), leaseMs: LEASE_MS });
    if (begun === "ineligible") return skip(c, row);
    if (begun === "lost") return stop;
  }
  // A drafted row claimed in Publish mode arrives as `publishing`: claimBatch has already checked its post is public.
  return (await publish(c, row, articleId as string)) ?? stop;
}

async function loadPost(c: Ctx, postId: string) {
  const [p] = await c.db
    .select({
      title: post.title,
      slug: post.slug,
      contentMd: post.contentMd,
      ogImagePath: post.ogImagePath,
      ogImageDeletedAt: post.ogImageDeletedAt,
    })
    .from(post)
    .where(and(eq(post.id, postId), PUBLIC_LISTED_FILTER))
    .limit(1);
  return p;
}
type PostRow = NonNullable<Awaited<ReturnType<typeof loadPost>>>;

async function makeDraft(c: Ctx, claim: Claim, p: PostRow): Promise<{ articleId: string | null; stop: Stop | null }> {
  // X prints the author's name under the title itself, so there is no byline block.
  const converted = markdownToContentState({
    contentMd: p.contentMd,
    siteUrl: c.siteUrl,
    backlink: { url: `${c.siteUrl}/blog/${p.slug}?utm_source=x` },
  });
  if (!converted.ok) {
    await attention(c, claim, "converter_refused", `${converted.reason}: ${converted.detail}`);
    return { articleId: null, stop: null };
  }

  const cover = await prepareCover(c, p);
  const timeoutMs = budget(c);
  if (timeoutMs === null) {
    await putBack(c, claim, WALL.holdMs);
    return { articleId: null, stop: WALL };
  }
  const res = await createDraft(
    c.creds,
    { title: p.title, contentState: converted.contentState, coverMediaId: cover.mediaId },
    { fetchImpl: c.fetchImpl, timeoutMs },
  );
  const low = isLow(res.meta, DRAFT_RESERVE) ? DAILY : null;
  if (!res.ok) return { articleId: null, stop: (await failed(c, claim, "draft", res)) ?? low };

  if (!(await saveDraft(c.db, claim, { articleId: res.value.articleId, coverStatus: cover.status }, c.now()))) {
    console.error(`[x-articles] row ${claim.id} was taken over after X made draft ${res.value.articleId}`);
    return { articleId: null, stop: low };
  }
  return { articleId: res.value.articleId, stop: low };
}

async function publish(c: Ctx, claim: Claim, articleId: string): Promise<Stop | null> {
  const timeoutMs = budget(c);
  if (timeoutMs === null) {
    await putBack(c, claim, WALL.holdMs);
    return WALL;
  }
  const res = await publishDraft(c.creds, articleId, { fetchImpl: c.fetchImpl, timeoutMs });
  const low = isLow(res.meta, PUBLISH_RESERVE) ? DAILY : null;
  if (!res.ok) return (await failed(c, claim, "publish", res)) ?? low;

  const unconfirmed = await lookupProblem(c, res.value.postId);
  if (unconfirmed) {
    await attention(c, claim, "publish_ambiguous", unconfirmed);
    return low;
  }
  if (await markPublished(c.db, claim, res.value.postId, c.now())) c.summary.published++;
  else console.error(`[x-articles] X post ${res.value.postId} is live but row ${claim.id} was taken over`);
  return low;
}

// Null when X finds the post; otherwise why the publish cannot be believed. Whatever the
// reason, the publish was sent and is never sent again.
async function lookupProblem(c: Ctx, postId: string): Promise<string | null> {
  const timeoutMs = budget(c);
  if (timeoutMs === null) return "publish answered ok but there was no time left to find the post";
  const found = await getPost(c.creds, postId, { fetchImpl: c.fetchImpl, timeoutMs });
  if (found.ok) return null;
  return found.kind === "not_found"
    ? "publish answered ok but the post could not be found"
    : `publish answered ok but the post lookup failed: ${found.detail}`;
}

async function prepareCover(c: Ctx, p: PostRow): Promise<{ status: CoverStatus; mediaId?: string }> {
  if (!p.ogImagePath || p.ogImageDeletedAt) return { status: "none" };
  // A cover must never block the Article, so every problem here ends as "failed".
  const fetchMs = budget(c);
  const bytes = fetchMs === null ? null : await fetchCover(c, p.ogImagePath, fetchMs);
  const cropped = bytes && (await cropCoverTo52(bytes));
  const uploadMs = budget(c);
  if (!cropped?.ok || uploadMs === null) return { status: "failed" };

  const up = await uploadMedia(c.creds, { bytes: cropped.value, mediaCategory: "tweet_image" }, { fetchImpl: c.fetchImpl, timeoutMs: uploadMs });
  return up.ok ? { status: "uploaded", mediaId: up.value.mediaId } : { status: "failed" };
}

// The stored cover URL comes from the database, so only the R2 bucket is ever fetched:
// https, the bucket's host, no redirects, a size cap.
async function fetchCover(c: Ctx, url: string, timeoutMs: number): Promise<Uint8Array | null> {
  try {
    const target = new URL(url);
    const bucket = process.env.R2_PUBLIC_URL;
    if (!bucket || target.protocol !== "https:" || target.host !== new URL(bucket).host) return null;
    const resp = await c.fetchImpl(target, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok || Number(resp.headers.get("content-length")) > MAX_COVER_BYTES) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return bytes.length > MAX_COVER_BYTES ? null : bytes;
  } catch {
    return null;
  }
}

// What X's answer means for the row, and whether the whole tick must stop.
async function failed(c: Ctx, claim: Claim, step: "draft" | "publish", f: XFailure): Promise<Stop | null> {
  // Once a publish is sent, anything short of a clean refusal may have posted: never retry it.
  const kind = step === "publish" && f.kind === "transient" ? "ambiguous" : f.kind;
  switch (kind) {
    case "auth":
      await attention(c, claim, "x_auth", f.detail);
      return { reason: "auth", holdMs: HOLD_MS };
    case "rejected":
      await attention(c, claim, "x_rejected", f.detail);
      return null;
    case "ambiguous":
      await attention(c, claim, "publish_ambiguous", f.detail);
      return null;
    case "rate_limited": {
      const holdMs = f.retryAfterMs ?? 0;
      await putBack(c, claim, holdMs);
      return { reason: "rate_limited", holdMs };
    }
    case "transient":
      await putBack(c, claim, 0, step === "draft" && (f.status ?? 0) >= 500);
      return null;
  }
}

const isLow = (meta: XMeta | undefined, reserve: number) =>
  meta?.userLimit24hRemaining !== undefined && meta.userLimit24hRemaining <= reserve;

// Time to give one call: null when too little of the tick is left.
function budget(c: Ctx): number | null {
  const ms = Math.min(CALL_TIMEOUT_MS, c.deadline - c.now().getTime());
  return ms >= MIN_CALL_MS ? ms : null;
}

async function attention(c: Ctx, claim: Claim, reason: AttentionReason, detail: string) {
  if (await markAttention(c.db, claim, reason, detail, c.now())) {
    c.summary.attention++;
    console.warn(`[x-articles] row ${claim.id} needs attention: ${reason}`);
  }
}

async function putBack(c: Ctx, claim: Claim, holdMs: number, countsAttempt = false) {
  if (await release(c.db, claim, { now: c.now(), countsAttempt, retryAfterMs: holdMs })) c.summary.released++;
}

async function skip(c: Ctx, claim: Claim): Promise<null> {
  if (await markSkipped(c.db, claim, c.now())) c.summary.skipped++;
  return null;
}
