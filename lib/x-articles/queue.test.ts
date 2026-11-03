import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeXQueueTestDb, type XQueueTestDb } from "../../tests/helpers/x-queue-test-db";
import {
  beginPublishing,
  claimBatch,
  countNeedsAttention,
  enqueueDue,
  markAttention,
  markDraftOnly,
  markPublished,
  markSkipped,
  recoverStale,
  release,
  saveDraft,
} from "./queue";

// Fence races are proven sequentially (A claims, the lease expires, B takes over,
// A's late write matches nothing) because pglite is one connection. The
// concurrent proofs live in tests/real-pg/x-article-queue.real-pg.test.ts.

let h: XQueueTestDb;
const NOW = new Date("2026-11-03T01:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const LEASE = 2 * MIN;
const ARTICLE = "2117512156132618240";
const X_POST = "2117999999999999999";

beforeAll(async () => {
  h = await makeXQueueTestDb(new Date(NOW.getTime() - HOUR));
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

interface Seed {
  status?: string;
  claimedBy?: string | null;
  claimedUntil?: Date | null;
  attempts?: number;
  nextAttemptAt?: Date;
  articleId?: string | null;
  xPostId?: string | null;
  coverStatus?: string;
  reason?: string | null;
  createdAt?: Date;
}

// Insert a post and its queue row directly, bypassing queue.ts. Defaults make a
// row that satisfies every CHECK for its status, so a test overrides one column
// to break one rule.
const seed = async (s: Seed = {}) => {
  const status = s.status ?? "queued";
  const leased = status === "working" || status === "publishing";
  const postId = await h.addPost();
  const claimedBy = s.claimedBy !== undefined ? s.claimedBy : leased ? randomUUID() : null;
  const res = await h.client.query<{ id: string }>(
    `INSERT INTO x_article_publication
       (post_id, status, claimed_by, claimed_until, attempts, next_attempt_at, article_id, x_post_id, cover_status, attention_reason, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
    [
      postId,
      status,
      claimedBy,
      s.claimedUntil !== undefined ? s.claimedUntil : leased ? new Date(NOW.getTime() + LEASE) : null,
      s.attempts ?? 0,
      s.nextAttemptAt ?? NOW,
      s.articleId !== undefined
        ? s.articleId
        : ["drafted", "publishing", "draft_only", "published"].includes(status)
          ? ARTICLE
          : null,
      s.xPostId !== undefined ? s.xPostId : status === "published" ? X_POST : null,
      s.coverStatus ?? "none",
      s.reason !== undefined ? s.reason : ["needs_attention", "skipped"].includes(status) ? "stale" : null,
      s.createdAt ?? NOW,
    ],
  );
  return { id: res.rows[0].id, postId, claimedBy: claimedBy as string };
};
const row = async (id: string) =>
  (await h.client.query<Record<string, unknown>>(`SELECT * FROM x_article_publication WHERE id = $1`, [id])).rows[0];
const at = (v: unknown) => new Date(v as string | Date).getTime();
// drizzle wraps a Postgres error as "Failed query"; the constraint name is on `cause`.
const rejectsByConstraint = async (p: Promise<unknown>, name: string) => {
  const err = await p.then(() => null, (e: Error) => e);
  expect(err, "the write should have been refused").not.toBeNull();
  expect(String(err?.cause)).toContain(name);
};
const claim = (over: Partial<Parameters<typeof claimBatch>[1]> = {}) =>
  claimBatch(h.db, { now: NOW, leaseMs: LEASE, limit: 5, claimDrafted: true, ...over });

describe("the table refuses impossible rows", () => {
  it("rejects a status outside the list", async () => {
    await expect(seed({ status: "bogus" })).rejects.toThrow(/x_article_publication_status_check/);
  });

  it("rejects a working row with no lease, and a queued row holding one", async () => {
    await expect(seed({ status: "working", claimedBy: null })).rejects.toThrow(/x_article_publication_lease_check/);
    await expect(seed({ status: "queued", claimedBy: randomUUID(), claimedUntil: NOW })).rejects.toThrow(
      /x_article_publication_lease_check/,
    );
  });

  it("rejects drafted, publishing, draft_only and published rows with no article id", async () => {
    for (const status of ["drafted", "publishing", "draft_only", "published"]) {
      await expect(seed({ status, articleId: null })).rejects.toThrow(/x_article_publication_article_check/);
    }
  });

  it("rejects a published row with no X post id, and an X post id on any other row", async () => {
    await expect(seed({ status: "published", xPostId: null })).rejects.toThrow(/x_article_publication_published_check/);
    await expect(seed({ status: "queued", xPostId: X_POST })).rejects.toThrow(/x_article_publication_published_check/);
  });

  it("rejects needs_attention and skipped rows with no reason, and a reason on any other row", async () => {
    await expect(seed({ status: "needs_attention", reason: null })).rejects.toThrow(/x_article_publication_reason_check/);
    await expect(seed({ status: "skipped", reason: null })).rejects.toThrow(/x_article_publication_reason_check/);
    await expect(seed({ status: "queued", reason: "stale" })).rejects.toThrow(/x_article_publication_reason_check/);
  });

  it("rejects a cover status outside the list", async () => {
    await expect(seed({ coverStatus: "weird" })).rejects.toThrow(/x_article_publication_cover_status_check/);
  });

  it("allows one row per post and keeps the row when its post is deleted from under it", async () => {
    const { id, postId } = await seed();
    await expect(
      h.client.query(`INSERT INTO x_article_publication (post_id) VALUES ($1)`, [postId]),
    ).rejects.toThrow(/x_article_publication_post_id_unique/);
    await expect(h.client.query(`DELETE FROM post WHERE id = $1`, [postId])).rejects.toThrow(
      /x_article_publication_post_id_post_id_fk/,
    );
    expect((await row(id)).status).toBe("queued");
  });
});

describe("enqueueDue", () => {
  it("queues a public, listed post published inside the window", async () => {
    const postId = await h.addPost();
    expect(await enqueueDue(h.db, NOW)).toBe(1);
    const r = (await h.client.query<Record<string, unknown>>(`SELECT * FROM x_article_publication WHERE post_id = $1`, [postId])).rows[0];
    expect(r).toMatchObject({ status: "queued", attempts: 0, cover_status: "none" });
    expect(at(r.next_attempt_at)).toBe(NOW.getTime());
    expect(at(r.created_at)).toBe(NOW.getTime());
  });

  it("is idempotent: a second call adds nothing and leaves the row alone", async () => {
    await h.addPost();
    await enqueueDue(h.db, NOW);
    const later = new Date(NOW.getTime() + MIN);
    expect(await enqueueDue(h.db, later)).toBe(0);
    const [r] = (await h.client.query<Record<string, unknown>>(`SELECT created_at FROM x_article_publication`)).rows;
    expect(at(r.created_at)).toBe(NOW.getTime());
  });

  it("ignores drafts, scheduled posts, unlisted posts, archived posts and posts with no publish time", async () => {
    await h.addPost({ status: "draft" });
    await h.addPost({ status: "scheduled" });
    await h.addPost({ visibility: "unlisted" });
    await h.addPost({ archivedAt: new Date(NOW.getTime() - MIN) });
    await h.addPost({ publishedAt: null });
    expect(await enqueueDue(h.db, NOW)).toBe(0);
  });

  it("includes a post published exactly 24 h ago and excludes one a millisecond older", async () => {
    const edge = await h.addPost({ publishedAt: new Date(NOW.getTime() - 24 * HOUR) });
    await h.addPost({ publishedAt: new Date(NOW.getTime() - 24 * HOUR - 1) });
    expect(await enqueueDue(h.db, NOW)).toBe(1);
    const [r] = (await h.client.query<{ post_id: string }>(`SELECT post_id FROM x_article_publication`)).rows;
    expect(r.post_id).toBe(edge);
  });
});

describe("claimBatch", () => {
  it("claims a due queued row: status working, a fresh token and a lease", async () => {
    const { id, postId } = await seed();
    const [c] = await claim();
    expect(c).toMatchObject({ id, postId, status: "working", attempts: 0, articleId: null, coverStatus: "none" });
    const r = await row(id);
    expect(r).toMatchObject({ status: "working", claimed_by: c.claimedBy });
    expect(at(r.claimed_until)).toBe(NOW.getTime() + LEASE);
  });

  it("claims a due drafted row as publishing when drafted rows are allowed", async () => {
    const { id } = await seed({ status: "drafted" });
    const [c] = await claim();
    expect(c).toMatchObject({ id, status: "publishing", articleId: ARTICLE });
    expect(await row(id)).toMatchObject({ status: "publishing", claimed_by: c.claimedBy });
  });

  it.each([
    ["archived", `UPDATE post SET archived_at = now() WHERE id = $1`],
    ["unlisted", `UPDATE post SET visibility = 'unlisted' WHERE id = $1`],
    ["unpublished", `UPDATE post SET status = 'draft' WHERE id = $1`],
  ])("does not claim a drafted row for publishing once its post was %s", async (_label, change) => {
    const { id, postId } = await seed({ status: "drafted" });
    await h.client.query(change, [postId]);
    expect(await claim()).toEqual([]);
    expect((await row(id)).status).toBe("drafted");
  });

  it("leaves a drafted row alone when drafted rows are not allowed (Draft mode)", async () => {
    const { id } = await seed({ status: "drafted" });
    expect(await claim({ claimDrafted: false })).toEqual([]);
    expect((await row(id)).status).toBe("drafted");
  });

  it("skips rows that are not due yet", async () => {
    await seed({ nextAttemptAt: new Date(NOW.getTime() + MIN) });
    expect(await claim()).toEqual([]);
  });

  it("never claims a row in any other status", async () => {
    for (const status of ["working", "publishing", "draft_only", "published", "needs_attention", "skipped"]) {
      await seed({ status });
    }
    expect(await claim()).toEqual([]);
  });

  it("takes the oldest rows first and stops at the limit", async () => {
    const newest = await seed({ createdAt: new Date(NOW.getTime() - MIN) });
    const oldest = await seed({ createdAt: new Date(NOW.getTime() - 3 * MIN) });
    const middle = await seed({ createdAt: new Date(NOW.getTime() - 2 * MIN) });
    const claimed = await claim({ limit: 2 });
    expect(claimed.map((c) => c.id)).toEqual([oldest.id, middle.id]);
    expect((await row(newest.id)).status).toBe("queued");
  });

  it("hands a row to one claim only: the second claim finds nothing", async () => {
    await seed();
    expect(await claim()).toHaveLength(1);
    expect(await claim()).toEqual([]);
  });
});

describe("saveDraft", () => {
  it("records the article id and cover status and keeps the lease", async () => {
    const s = await seed({ status: "working" });
    expect(await saveDraft(h.db, s, { articleId: ARTICLE, coverStatus: "uploaded" }, NOW)).toBe(true);
    expect(await row(s.id)).toMatchObject({
      status: "working",
      article_id: ARTICLE,
      cover_status: "uploaded",
      claimed_by: s.claimedBy,
    });
  });

  it("loses to a different claimer and to a row that is no longer working", async () => {
    const s = await seed({ status: "working" });
    expect(await saveDraft(h.db, { id: s.id, claimedBy: randomUUID() }, { articleId: ARTICLE, coverStatus: "none" }, NOW)).toBe(false);
    const gone = await seed({ status: "queued" });
    expect(await saveDraft(h.db, { id: gone.id, claimedBy: randomUUID() }, { articleId: ARTICLE, coverStatus: "none" }, NOW)).toBe(false);
    expect((await row(s.id)).article_id).toBeNull();
  });
});

describe("markDraftOnly", () => {
  it("ends a working row that has an article as draft_only and clears the lease", async () => {
    const s = await seed({ status: "working", articleId: ARTICLE });
    expect(await markDraftOnly(h.db, s, NOW)).toBe(true);
    expect(await row(s.id)).toMatchObject({ status: "draft_only", claimed_by: null, claimed_until: null });
  });

  it("refuses a row with no article id (the table stops it)", async () => {
    const s = await seed({ status: "working" });
    await rejectsByConstraint(markDraftOnly(h.db, s, NOW), "x_article_publication_article_check");
  });

  it("loses to a different claimer and to the wrong status", async () => {
    const s = await seed({ status: "working", articleId: ARTICLE });
    expect(await markDraftOnly(h.db, { id: s.id, claimedBy: randomUUID() }, NOW)).toBe(false);
    const p = await seed({ status: "publishing" });
    expect(await markDraftOnly(h.db, p, NOW)).toBe(false);
  });
});

describe("beginPublishing", () => {
  it("moves a working row with an article to publishing and renews the lease", async () => {
    const s = await seed({ status: "working", articleId: ARTICLE, claimedUntil: new Date(NOW.getTime() + 1000) });
    expect(await beginPublishing(h.db, s, { now: NOW, leaseMs: LEASE })).toBe("ok");
    const r = await row(s.id);
    expect(r).toMatchObject({ status: "publishing", claimed_by: s.claimedBy });
    expect(at(r.claimed_until)).toBe(NOW.getTime() + LEASE);
  });

  it.each([
    ["archived", `UPDATE post SET archived_at = now() WHERE id = $1`],
    ["unlisted", `UPDATE post SET visibility = 'unlisted' WHERE id = $1`],
    ["unpublished", `UPDATE post SET status = 'draft' WHERE id = $1`],
  ])("says ineligible, and writes nothing, when the post was %s after the claim", async (_label, change) => {
    const s = await seed({ status: "working", articleId: ARTICLE });
    await h.client.query(change, [s.postId]);
    expect(await beginPublishing(h.db, s, { now: NOW, leaseMs: LEASE })).toBe("ineligible");
    expect(await row(s.id)).toMatchObject({ status: "working", claimed_by: s.claimedBy });
  });

  it("says lost when another claimer holds the row, even if the post is fine", async () => {
    const s = await seed({ status: "working", articleId: ARTICLE });
    expect(await beginPublishing(h.db, { id: s.id, claimedBy: randomUUID() }, { now: NOW, leaseMs: LEASE })).toBe("lost");
    expect((await row(s.id)).status).toBe("working");
  });

  it("says lost when the row is not working", async () => {
    const s = await seed({ status: "queued" });
    expect(await beginPublishing(h.db, { id: s.id, claimedBy: randomUUID() }, { now: NOW, leaseMs: LEASE })).toBe("lost");
  });

  it("refuses a row with no article id (the table stops it)", async () => {
    const s = await seed({ status: "working" });
    await rejectsByConstraint(beginPublishing(h.db, s, { now: NOW, leaseMs: LEASE }), "x_article_publication_article_check");
  });
});

describe("markPublished", () => {
  it("ends a publishing row as published with the X post id and clears the lease", async () => {
    const s = await seed({ status: "publishing" });
    expect(await markPublished(h.db, s, X_POST, NOW)).toBe(true);
    expect(await row(s.id)).toMatchObject({ status: "published", x_post_id: X_POST, claimed_by: null, claimed_until: null });
  });

  it("loses to a different claimer and to the wrong status", async () => {
    const s = await seed({ status: "publishing" });
    expect(await markPublished(h.db, { id: s.id, claimedBy: randomUUID() }, X_POST, NOW)).toBe(false);
    const w = await seed({ status: "working", articleId: ARTICLE });
    expect(await markPublished(h.db, w, X_POST, NOW)).toBe(false);
    expect((await row(s.id)).status).toBe("publishing");
  });
});

describe("release", () => {
  const rel = (c: { id: string; claimedBy: string }, over: Partial<Parameters<typeof release>[2]> = {}) =>
    release(h.db, c, { now: NOW, countsAttempt: false, ...over });

  it("puts a working row with no article back in the queue and clears the lease", async () => {
    const s = await seed({ status: "working" });
    expect(await rel(s)).toBe(true);
    expect(await row(s.id)).toMatchObject({ status: "queued", claimed_by: null, claimed_until: null, attempts: 0 });
  });

  it("returns a working row that has an article, and a publishing row, to drafted", async () => {
    const w = await seed({ status: "working", articleId: ARTICLE });
    const p = await seed({ status: "publishing" });
    expect(await rel(w)).toBe(true);
    expect(await rel(p)).toBe(true);
    expect((await row(w.id)).status).toBe("drafted");
    expect((await row(p.id)).status).toBe("drafted");
  });

  it("counts an attempt only when asked", async () => {
    const a = await seed({ status: "working", attempts: 1 });
    const b = await seed({ status: "working", attempts: 1 });
    await rel(a);
    await rel(b, { countsAttempt: true });
    expect((await row(a.id)).attempts).toBe(1);
    expect((await row(b.id)).attempts).toBe(2);
  });

  it("sends the row to needs_attention when a counted attempt reaches 3", async () => {
    const s = await seed({ status: "working", attempts: 2 });
    expect(await rel(s, { countsAttempt: true })).toBe(true);
    expect(await row(s.id)).toMatchObject({
      status: "needs_attention",
      attention_reason: "attempts_exhausted",
      attempts: 3,
      claimed_by: null,
      claimed_until: null,
    });
  });

  it.each([
    ["no younger than 1 minute", 2 * MIN, MIN],
    ["a quarter of the row's age", 80 * MIN, 20 * MIN],
    ["no longer than 60 minutes", 10 * HOUR, 60 * MIN],
  ])("backs off %s", async (_label, age, delay) => {
    const s = await seed({ status: "working", createdAt: new Date(NOW.getTime() - age) });
    await rel(s);
    expect(at((await row(s.id)).next_attempt_at)).toBe(NOW.getTime() + delay);
  });

  it("waits for X's Retry-After when it is longer than the backoff", async () => {
    const s = await seed({ status: "publishing" });
    await rel(s, { retryAfterMs: 15 * MIN });
    expect(at((await row(s.id)).next_attempt_at)).toBe(NOW.getTime() + 15 * MIN);
  });

  it("loses to a different claimer and to a row already released", async () => {
    const s = await seed({ status: "working" });
    expect(await rel({ id: s.id, claimedBy: randomUUID() })).toBe(false);
    expect(await rel(s)).toBe(true);
    expect(await rel(s)).toBe(false);
  });
});

describe("markAttention and markSkipped", () => {
  it.each(["working", "publishing"])("flags a %s row for a person with a reason and a trimmed detail", async (status) => {
    const s = await seed({ status, articleId: ARTICLE });
    expect(await markAttention(h.db, s, "x_rejected", "x".repeat(900), NOW)).toBe(true);
    const r = await row(s.id);
    expect(r).toMatchObject({ status: "needs_attention", attention_reason: "x_rejected", claimed_by: null, claimed_until: null });
    expect((r.attention_detail as string).length).toBe(500);
  });

  it("markAttention loses to a different claimer and to a row that holds no lease", async () => {
    const s = await seed({ status: "working" });
    expect(await markAttention(h.db, { id: s.id, claimedBy: randomUUID() }, "x_auth", "401", NOW)).toBe(false);
    const q = await seed({ status: "queued" });
    expect(await markAttention(h.db, { id: q.id, claimedBy: randomUUID() }, "x_auth", "401", NOW)).toBe(false);
  });

  it("skips a working row whose post is no longer public", async () => {
    const s = await seed({ status: "working" });
    expect(await markSkipped(h.db, s, NOW)).toBe(true);
    expect(await row(s.id)).toMatchObject({ status: "skipped", attention_reason: "post_not_public", claimed_by: null });
  });

  it("markSkipped loses to a different claimer and to the wrong status", async () => {
    const s = await seed({ status: "working" });
    expect(await markSkipped(h.db, { id: s.id, claimedBy: randomUUID() }, NOW)).toBe(false);
    const p = await seed({ status: "publishing" });
    expect(await markSkipped(h.db, p, NOW)).toBe(false);
  });
});

describe("recoverStale", () => {
  const past = new Date(NOW.getTime() - MIN);

  it("requeues a working row whose lease expired and counts the died run", async () => {
    const s = await seed({ status: "working", claimedUntil: past, attempts: 1, articleId: ARTICLE });
    const res = await recoverStale(h.db, NOW);
    expect(res).toMatchObject({ requeued: 1, ambiguous: 0, exhausted: 0, stale: 0 });
    expect(await row(s.id)).toMatchObject({ status: "queued", attempts: 2, claimed_by: null, claimed_until: null, article_id: ARTICLE });
  });

  it("sends a working row that died for the third time to needs_attention", async () => {
    const s = await seed({ status: "working", claimedUntil: past, attempts: 2 });
    const res = await recoverStale(h.db, NOW);
    expect(res).toMatchObject({ requeued: 0, exhausted: 1 });
    expect(await row(s.id)).toMatchObject({ status: "needs_attention", attention_reason: "attempts_exhausted", attempts: 3 });
  });

  it("leaves a lease that has not expired alone", async () => {
    const s = await seed({ status: "working", claimedUntil: new Date(NOW.getTime() + MIN) });
    expect(await recoverStale(h.db, NOW)).toMatchObject({ requeued: 0, exhausted: 0, ambiguous: 0, stale: 0 });
    expect((await row(s.id)).status).toBe("working");
  });

  it("always sends an expired publishing row to needs_attention, never back to the queue", async () => {
    const s = await seed({ status: "publishing", claimedUntil: past, attempts: 0 });
    const res = await recoverStale(h.db, NOW);
    expect(res).toMatchObject({ requeued: 0, ambiguous: 1 });
    expect(await row(s.id)).toMatchObject({
      status: "needs_attention",
      attention_reason: "publish_ambiguous",
      attempts: 0,
      claimed_by: null,
      claimed_until: null,
    });
  });

  it("sends queued and drafted rows older than 24 h to needs_attention as stale, and keeps younger ones", async () => {
    const oldQueued = await seed({ createdAt: new Date(NOW.getTime() - 24 * HOUR - 1) });
    const oldDrafted = await seed({ status: "drafted", createdAt: new Date(NOW.getTime() - 30 * HOUR) });
    const young = await seed({ createdAt: new Date(NOW.getTime() - 24 * HOUR) });
    const res = await recoverStale(h.db, NOW);
    expect(res.stale).toBe(2);
    expect(await row(oldQueued.id)).toMatchObject({ status: "needs_attention", attention_reason: "stale" });
    expect((await row(oldDrafted.id)).status).toBe("needs_attention");
    expect((await row(young.id)).status).toBe("queued");
  });

  it("skips a drafted row whose post is no longer public, and keeps one whose post still is", async () => {
    const withdrawn = await seed({ status: "drafted" });
    const fine = await seed({ status: "drafted" });
    await h.client.query(`UPDATE post SET archived_at = now() WHERE id = $1`, [withdrawn.postId]);
    const res = await recoverStale(h.db, NOW);
    expect(res.skipped).toBe(1);
    expect(await row(withdrawn.id)).toMatchObject({
      status: "skipped",
      attention_reason: "post_not_public",
      claimed_by: null,
      claimed_until: null,
    });
    expect((await row(fine.id)).status).toBe("drafted");
  });

  it("does not touch finished rows", async () => {
    const ids = [];
    for (const status of ["draft_only", "published", "needs_attention", "skipped"]) {
      ids.push((await seed({ status, createdAt: new Date(NOW.getTime() - 48 * HOUR) })).id);
    }
    expect(await recoverStale(h.db, NOW)).toMatchObject({ requeued: 0, ambiguous: 0, exhausted: 0, stale: 0 });
    expect((await Promise.all(ids.map(row))).map((r) => r.status)).toEqual(["draft_only", "published", "needs_attention", "skipped"]);
  });
});

describe("countNeedsAttention", () => {
  it("is zero on an empty table", async () => {
    expect(await countNeedsAttention(h.db)).toBe(0);
  });

  it("counts only the rows a person must look at", async () => {
    await seed({ status: "needs_attention", reason: "x_auth" });
    await seed({ status: "needs_attention", reason: "publish_ambiguous" });
    for (const status of ["queued", "working", "drafted", "publishing", "draft_only", "published", "skipped"]) await seed({ status });
    expect(await countNeedsAttention(h.db)).toBe(2);
  });
});

describe("a replaced worker cannot commit over the worker that replaced it", () => {
  it("A's late write after recovery and B's claim matches nothing; B's write lands", async () => {
    await seed();
    const [a] = await claim();
    const later = new Date(NOW.getTime() + LEASE + MIN);
    await recoverStale(h.db, later);
    const [b] = await claimBatch(h.db, { now: later, leaseMs: LEASE, limit: 5, claimDrafted: true });
    expect(b.id).toBe(a.id);
    expect(b.claimedBy).not.toBe(a.claimedBy);

    expect(await saveDraft(h.db, a, { articleId: ARTICLE, coverStatus: "none" }, later)).toBe(false);
    expect((await row(a.id)).article_id).toBeNull();
    expect(await saveDraft(h.db, b, { articleId: ARTICLE, coverStatus: "none" }, later)).toBe(true);
  });

  it("a late publish result after the lease expired matches nothing", async () => {
    const s = await seed({ status: "publishing", claimedUntil: new Date(NOW.getTime() - MIN) });
    await recoverStale(h.db, NOW);
    expect(await markPublished(h.db, s, X_POST, NOW)).toBe(false);
    expect(await row(s.id)).toMatchObject({ status: "needs_attention", attention_reason: "publish_ambiguous", x_post_id: null });
  });
});

describe("the whole journey", () => {
  it("sweep, claim, draft, publish", async () => {
    const postId = await h.addPost();
    expect(await enqueueDue(h.db, NOW)).toBe(1);
    const [c] = await claim();
    expect(c.postId).toBe(postId);
    expect(await saveDraft(h.db, c, { articleId: ARTICLE, coverStatus: "uploaded" }, NOW)).toBe(true);
    expect(await beginPublishing(h.db, c, { now: NOW, leaseMs: LEASE })).toBe("ok");
    expect(await markPublished(h.db, c, X_POST, NOW)).toBe(true);
    expect(await row(c.id)).toMatchObject({ status: "published", article_id: ARTICLE, x_post_id: X_POST, cover_status: "uploaded" });
    expect(await claim()).toEqual([]);
  });

  it("Draft mode: sweep, claim, draft, draft_only, never claimed again", async () => {
    await h.addPost();
    await enqueueDue(h.db, NOW);
    const [c] = await claim({ claimDrafted: false });
    await saveDraft(h.db, c, { articleId: ARTICLE, coverStatus: "none" }, NOW);
    expect(await markDraftOnly(h.db, c, NOW)).toBe(true);
    expect(await claim({ claimDrafted: true })).toEqual([]);
    expect(await recoverStale(h.db, new Date(NOW.getTime() + 48 * HOUR))).toMatchObject({ stale: 0 });
  });
});
