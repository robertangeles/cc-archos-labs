import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeQueueTestDb, type QueueTestDb } from "../../tests/helpers/queue-test-db";

// Queue mechanics against a REAL Postgres engine (pglite). Mocks cannot prove
// that a WHERE clause selects the right rows or that RETURNING gives back what
// was written; this can.
//
// Caveat, inherited and deliberate: pglite is single-connection, so this does
// NOT exercise FOR UPDATE SKIP LOCKED under real concurrency. It validates the
// predicates, the state transitions, and the attempts accounting — which is
// what the sweeper's correctness actually rests on.

let harness: QueueTestDb;
vi.mock("../db", () => ({ getDb: () => harness.db }));

const { claimNextItem, releaseItem, sweepStaleLocks, pendingCount, LOCK_TTL_MS, MAX_ATTEMPTS } =
  await import("./queue");

beforeEach(async () => {
  harness = await makeQueueTestDb();
});
afterEach(async () => {
  await harness.close();
});

describe("claimNextItem", () => {
  it("returns null on an empty queue", async () => {
    expect(await claimNextItem("w1")).toBeNull();
  });

  it("claims in day_number order, not insertion order", async () => {
    await harness.createItem({ dayNumber: 3, title: "third" });
    await harness.createItem({ dayNumber: 1, title: "first" });
    await harness.createItem({ dayNumber: 2, title: "second" });

    const a = await claimNextItem("w1");
    expect(a?.title).toBe("first");
  });

  it("flips the row to running and stamps the worker and lock", async () => {
    await harness.createItem({ dayNumber: 1 });
    const now = new Date("2026-07-25T10:00:00Z");

    const item = await claimNextItem("worker-abc", now);

    expect(item?.status).toBe("running");
    expect(item?.lockedBy).toBe("worker-abc");
    expect(item?.lockedUntil?.getTime()).toBe(now.getTime() + LOCK_TTL_MS);
    expect(item?.attempts).toBe(1);
  });

  it("increments attempts on each successive claim", async () => {
    const id = await harness.createItem({ dayNumber: 1 });
    await claimNextItem("w1");
    await harness.setStatus(id, "pending");
    const second = await claimNextItem("w2");
    expect(second?.attempts).toBe(2);
  });

  it("never claims an item that is already running", async () => {
    await harness.createItem({ dayNumber: 1 });
    expect(await claimNextItem("w1")).not.toBeNull();
    expect(await claimNextItem("w2"), "second worker must find nothing").toBeNull();
  });

  it("ignores terminal items", async () => {
    const a = await harness.createItem({ dayNumber: 1 });
    const b = await harness.createItem({ dayNumber: 2 });
    const c = await harness.createItem({ dayNumber: 3 });
    await harness.setStatus(a, "drafted");
    await harness.setStatus(b, "failed");
    await harness.setStatus(c, "skipped");
    expect(await claimNextItem("w1")).toBeNull();
  });
});

describe("releaseItem", () => {
  it("clears the lock and records the terminal state", async () => {
    const id = await harness.createItem({ dayNumber: 1 });
    await claimNextItem("w1");

    await releaseItem(id, "drafted", { judgeVerdict: { verdict: "pass" } });

    const row = await harness.get(id);
    expect(row.status).toBe("drafted");
    expect(row.locked_by).toBeNull();
    expect(row.locked_until).toBeNull();
    expect(row.judge_verdict).toEqual({ verdict: "pass" });
  });

  it("records the error when releasing as failed", async () => {
    const id = await harness.createItem({ dayNumber: 1 });
    await claimNextItem("w1");
    await releaseItem(id, "failed", { lastError: "research returned empty" });
    const row = await harness.get(id);
    expect(row.status).toBe("failed");
    expect(row.last_error).toBe("research returned empty");
  });

  it("makes a released-to-pending item claimable again", async () => {
    const id = await harness.createItem({ dayNumber: 1 });
    await claimNextItem("w1");
    await releaseItem(id, "pending");
    expect(await claimNextItem("w2")).not.toBeNull();
  });
});

describe("sweepStaleLocks", () => {
  const now = new Date("2026-07-25T12:00:00Z");
  const expired = new Date(now.getTime() - 60_000);

  it("does nothing when there is nothing stale", async () => {
    await harness.createItem({ dayNumber: 1 });
    expect(await sweepStaleLocks(now)).toEqual({
      reclaimed: 0,
      exhausted: 0,
      exhaustedIds: [],
    });
  });

  it("leaves a running item whose lock has NOT expired", async () => {
    const id = await harness.createItem({ dayNumber: 1 });
    await harness.setRunning(id, "w1", new Date(now.getTime() + 60_000), 1);
    const r = await sweepStaleLocks(now);
    expect(r.reclaimed).toBe(0);
    expect((await harness.get(id)).status).toBe("running");
  });

  it("reclaims an abandoned run so the pipeline does not silently stop", async () => {
    // The normal cause: Render replaces the instance mid-run during a deploy.
    const id = await harness.createItem({ dayNumber: 1 });
    await harness.setRunning(id, "dead-worker", expired, 1);

    const r = await sweepStaleLocks(now);

    expect(r.reclaimed).toBe(1);
    const row = await harness.get(id);
    expect(row.status).toBe("pending");
    expect(row.locked_by).toBeNull();
    expect(row.last_error).toMatch(/abandoned mid-flight/i);
    expect(await claimNextItem("w2", now)).not.toBeNull();
  });

  it("parks an item that has burned every attempt instead of looping forever", async () => {
    const id = await harness.createItem({ dayNumber: 1 });
    await harness.setRunning(id, "w1", expired, MAX_ATTEMPTS);

    const r = await sweepStaleLocks(now);

    expect(r.exhausted).toBe(1);
    expect(r.exhaustedIds).toEqual([id]);
    const row = await harness.get(id);
    expect(row.status).toBe("failed");
    expect(row.last_error).toMatch(/3 times/);
  });

  it("handles a mixed sweep of retryable and exhausted items", async () => {
    const retry = await harness.createItem({ dayNumber: 1 });
    const dead = await harness.createItem({ dayNumber: 2 });
    await harness.setRunning(retry, "w1", expired, 1);
    await harness.setRunning(dead, "w1", expired, MAX_ATTEMPTS);

    const r = await sweepStaleLocks(now);

    expect(r.reclaimed).toBe(1);
    expect(r.exhausted).toBe(1);
    expect((await harness.get(retry)).status).toBe("pending");
    expect((await harness.get(dead)).status).toBe("failed");
  });
});

describe("pendingCount", () => {
  it("counts only pending items", async () => {
    await harness.createItem({ dayNumber: 1 });
    await harness.createItem({ dayNumber: 2 });
    const done = await harness.createItem({ dayNumber: 3 });
    await harness.setStatus(done, "drafted");
    expect(await pendingCount()).toBe(2);
  });

  it("returns 0 on an empty queue", async () => {
    expect(await pendingCount()).toBe(0);
  });
});
