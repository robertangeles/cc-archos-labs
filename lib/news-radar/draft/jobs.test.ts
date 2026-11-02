import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeDraftTestDb, type DraftTestDb } from "../../../tests/helpers/draft-test-db";
import {
  claimNext,
  countStartedToday,
  countSucceeded,
  enqueueKept,
  finishFailed,
  finishNeedsAttention,
  finishSucceeded,
  recordStep,
  recoverStale,
  renewLease,
  requeueJob,
} from "./jobs";

// Lease races are proven the way the radar's are: sequentially (A claims, the lease
// expires, B takes over, A's late commit matches nothing), because pglite is one
// connection and cannot run SKIP LOCKED concurrently.

let h: DraftTestDb;
const NOW = new Date("2026-11-02T01:00:00Z"); // 12:00 in Melbourne
const MIN = 60_000;
const LEASE = 20 * MIN;

beforeAll(async () => {
  h = await makeDraftTestDb();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const kept = async (title?: string) => {
  const id = await h.addCandidate({ title });
  await h.label(id, "keep");
  return id;
};
const job = async (candidateId: string) =>
  (await h.client.query<Record<string, unknown>>(`SELECT * FROM news_draft_job WHERE candidate_id = $1`, [candidateId])).rows[0];
const claim = (cap = 3, now = NOW) => claimNext(h.db, { now, leaseMs: LEASE, cap });

describe("enqueueKept", () => {
  it("queues a story whose latest label is keep", async () => {
    const id = await kept();
    expect(await enqueueKept(h.db)).toBe(1);
    expect((await job(id)).status).toBe("queued");
  });

  it("is idempotent: a second call adds nothing", async () => {
    await kept();
    await enqueueKept(h.db);
    expect(await enqueueKept(h.db)).toBe(0);
  });

  it("ignores skipped, cleared, unlabelled and Kept-then-Skipped stories", async () => {
    const skipped = await h.addCandidate();
    await h.label(skipped, "skip");
    const cleared = await h.addCandidate();
    await h.label(cleared, "keep");
    await h.label(cleared, "clear");
    const flipped = await h.addCandidate();
    await h.label(flipped, "keep");
    await h.label(flipped, "skip");
    await h.addCandidate(); // never labelled
    expect(await enqueueKept(h.db)).toBe(0);
  });

  it("queues a story Skipped first and Kept later (the latest label wins)", async () => {
    const id = await h.addCandidate();
    await h.label(id, "skip");
    await h.label(id, "keep");
    expect(await enqueueKept(h.db)).toBe(1);
  });
});

describe("claimNext", () => {
  it("claims the oldest queued job and takes the lease", async () => {
    const first = await kept("First");
    await kept("Second");
    await enqueueKept(h.db);
    const c = await claim();
    expect(c).toMatchObject({ candidateId: first, title: "First", attempts: 1 });
    const row = await job(first);
    expect(row).toMatchObject({ status: "running", attempts: 1 });
    expect(row.claimed_by).toBe(c!.claimedBy);
    expect(new Date(row.claimed_until as string).getTime()).toBe(NOW.getTime() + LEASE);
    expect(row.started_at).not.toBeNull();
  });

  it("returns null when there is nothing queued", async () => {
    expect(await claim()).toBeNull();
  });

  it("runs one job at a time: a live lease blocks every other claim", async () => {
    await kept();
    await kept();
    await enqueueKept(h.db);
    expect(await claim()).not.toBeNull();
    expect(await claim(3, new Date(NOW.getTime() + 5 * MIN))).toBeNull();
  });

  it("an EXPIRED lease no longer blocks (recovery handles the stuck job separately)", async () => {
    await kept();
    await kept();
    await enqueueKept(h.db);
    await claim();
    const later = new Date(NOW.getTime() + LEASE + MIN);
    const c = await claim(3, later);
    expect(c).not.toBeNull();
  });

  it("stops at the daily cap", async () => {
    for (let i = 0; i < 3; i++) await kept();
    await enqueueKept(h.db);
    const a = (await claim(2))!;
    await finishSucceeded(h.db, a, await h.addPost(), NOW);
    const b = (await claim(2))!;
    await finishSucceeded(h.db, b, await h.addPost(), NOW);
    expect(await claim(2)).toBeNull(); // third waits for tomorrow
  });

  it("the cap counts the Melbourne day, not the UTC day", async () => {
    // Started 12:30 UTC on 2 Nov = 23:30 on 2 Nov in Melbourne; NOW is 12:00 on 2 Nov.
    const id = await kept();
    await enqueueKept(h.db);
    await h.client.query(
      `UPDATE news_draft_job SET status='succeeded', started_at=$1, finished_at=$1 WHERE candidate_id=$2`,
      [new Date("2026-11-02T12:30:00Z"), id],
    );
    // At 20:00 UTC (07:00 on 3 Nov in Melbourne) that start is a different Melbourne day.
    expect(await countStartedToday(h.db, new Date("2026-11-02T20:00:00Z"))).toBe(0);
    // At 12:45 UTC (23:45 on 2 Nov in Melbourne) it is the same day.
    expect(await countStartedToday(h.db, new Date("2026-11-02T12:45:00Z"))).toBe(1);
  });

  it("a restart does not spend the cap twice", async () => {
    await kept();
    await enqueueKept(h.db);
    await claim(1);
    await recoverStale(h.db, new Date(NOW.getTime() + LEASE + MIN), 2);
    // started_at was set on the first claim and stays, so the count is still 1 and cap 1 blocks nothing new.
    expect(await countStartedToday(h.db, NOW)).toBe(1);
  });

  it("cancels a queued job whose story was un-Kept, and claims the next one", async () => {
    const a = await kept("A");
    const b = await kept("B");
    await enqueueKept(h.db);
    await h.label(a, "skip"); // Rob changed his mind before it started
    const c = await claim();
    expect(c?.candidateId).toBe(b);
    expect((await job(a)).status).toBe("cancelled");
    expect((await job(a)).finished_at).not.toBeNull();
  });
});

describe("renewLease and finishing", () => {
  it("renews only for the run that holds it", async () => {
    await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    expect(await renewLease(h.db, c, new Date(NOW.getTime() + 10 * MIN), LEASE)).toBe(true);
    expect(await renewLease(h.db, { ...c, claimedBy: randomUUID() }, NOW, LEASE)).toBe(false);
  });

  it("a replaced run cannot finish the job that replaced it", async () => {
    await kept();
    await enqueueKept(h.db);
    const a = (await claim())!;
    await recoverStale(h.db, new Date(NOW.getTime() + LEASE + MIN), 2); // A's lease lapsed
    const b = (await claim(3, new Date(NOW.getTime() + LEASE + 2 * MIN)))!;
    expect(b.claimedBy).not.toBe(a.claimedBy);
    // A wakes up late and tries to commit.
    expect(await finishSucceeded(h.db, a, await h.addPost(), new Date(NOW.getTime() + LEASE + 3 * MIN))).toBe(false);
    expect(await finishNeedsAttention(h.db, a, "failed_gates", "late", NOW)).toBe(false);
    expect((await job(a.candidateId)).status).toBe("running");
    expect(await finishSucceeded(h.db, b, await h.addPost(), NOW)).toBe(true);
  });

  it("succeeded stores the post and clears the lease", async () => {
    const id = await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    const postId = await h.addPost();
    expect(await finishSucceeded(h.db, c, postId, NOW)).toBe(true);
    expect(await job(id)).toMatchObject({ status: "succeeded", post_id: postId, claimed_by: null, claimed_until: null });
  });

  it("needs_attention stores the reason and a short detail", async () => {
    const id = await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    expect(await finishNeedsAttention(h.db, c, "no_primary_source", "tried 3 links, all blocked", NOW)).toBe(true);
    expect(await job(id)).toMatchObject({
      status: "needs_attention",
      attention_reason: "no_primary_source",
      attention_detail: "tried 3 links, all blocked",
      claimed_by: null,
    });
  });

  it("failed stores the reason", async () => {
    const id = await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    expect(await finishFailed(h.db, c, "lease_expired", "gave up", NOW)).toBe(true);
    expect((await job(id)).status).toBe("failed");
  });

  it("truncates a very long detail instead of storing an essay", async () => {
    const id = await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    await finishNeedsAttention(h.db, c, "failed_gates", "x".repeat(5000), NOW);
    expect(((await job(id)).attention_detail as string).length).toBeLessThanOrEqual(500);
  });
});

describe("requeueJob and countSucceeded", () => {
  it("gives a running job back so it can be tried again, keeping its attempt count", async () => {
    const id = await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    expect(await requeueJob(h.db, c, NOW)).toBe(true);
    expect(await job(id)).toMatchObject({ status: "queued", attempts: 1, claimed_by: null });
    const again = (await claim(3, new Date(NOW.getTime() + MIN)))!;
    expect(again.attempts).toBe(2);
  });

  it("a run that lost the job cannot give it back", async () => {
    await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    expect(await requeueJob(h.db, { ...c, claimedBy: randomUUID() }, NOW)).toBe(false);
  });

  it("counts only succeeded jobs", async () => {
    await kept();
    await kept();
    await enqueueKept(h.db);
    const a = (await claim())!;
    await finishSucceeded(h.db, a, await h.addPost(), NOW);
    const b = (await claim())!;
    await finishNeedsAttention(h.db, b, "failed_gates", "x", NOW);
    expect(await countSucceeded(h.db)).toBe(1);
  });
});

describe("recoverStale", () => {
  it("puts a job with an expired lease back in the queue", async () => {
    const id = await kept();
    await enqueueKept(h.db);
    await claim();
    const r = await recoverStale(h.db, new Date(NOW.getTime() + LEASE + MIN), 2);
    expect(r).toEqual({ requeued: 1, failed: 0 });
    expect(await job(id)).toMatchObject({ status: "queued", claimed_by: null });
  });

  it("leaves a live lease alone", async () => {
    await kept();
    await enqueueKept(h.db);
    await claim();
    expect(await recoverStale(h.db, new Date(NOW.getTime() + 5 * MIN), 2)).toEqual({ requeued: 0, failed: 0 });
  });

  it("fails a job that has used every attempt, with a reason", async () => {
    const id = await kept();
    await enqueueKept(h.db);
    await claim();
    await recoverStale(h.db, new Date(NOW.getTime() + LEASE + MIN), 2); // attempt 1 lost -> requeued
    await claimNext(h.db, { now: new Date(NOW.getTime() + LEASE + 2 * MIN), leaseMs: LEASE, cap: 3 }); // attempt 2
    const r = await recoverStale(h.db, new Date(NOW.getTime() + 3 * LEASE), 2);
    expect(r).toEqual({ requeued: 0, failed: 1 });
    expect(await job(id)).toMatchObject({ status: "failed", attention_reason: "lease_expired" });
  });
});

describe("recordStep", () => {
  it("stores a step with its cost", async () => {
    const id = await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    await recordStep(h.db, c.id, { stepKey: "essay", attempt: 1, status: "ok", output: "text", model: "m", inputTokens: 10, outputTokens: 20, costUsd: 0.1234, durationMs: 5000 });
    const rows = (await h.client.query<Record<string, unknown>>(`SELECT * FROM news_draft_step WHERE job_id = $1`, [c.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ step_key: "essay", status: "ok", output: "text", duration_ms: 5000 });
    expect(Number(rows[0].cost_usd)).toBeCloseTo(0.1234, 6);
    expect(id).toBeTruthy();
  });

  it("replaces a step recorded twice for the same attempt", async () => {
    await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    const base = { stepKey: "research", attempt: 1, status: "ok" as const, model: null, inputTokens: null, outputTokens: null, costUsd: null, durationMs: 1 };
    await recordStep(h.db, c.id, { ...base, output: "first" });
    await recordStep(h.db, c.id, { ...base, output: "second" });
    const rows = (await h.client.query<{ output: string }>(`SELECT output FROM news_draft_step WHERE job_id = $1`, [c.id])).rows;
    expect(rows.map((r) => r.output)).toEqual(["second"]);
  });

  it("keeps a restarted job's steps under their own attempt number", async () => {
    await kept();
    await enqueueKept(h.db);
    const c = (await claim())!;
    const base = { stepKey: "research", status: "ok" as const, output: "o", model: null, inputTokens: null, outputTokens: null, costUsd: null, durationMs: 1 };
    await recordStep(h.db, c.id, { ...base, attempt: 1 });
    await recordStep(h.db, c.id, { ...base, attempt: 2 });
    expect((await h.client.query(`SELECT 1 FROM news_draft_step WHERE job_id = $1`, [c.id])).rows).toHaveLength(2);
  });
});
