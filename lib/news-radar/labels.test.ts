import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema";
import type { DB } from "../db";
import { makeRadarTestDb, type RadarTestDb } from "../../tests/helpers/radar-test-db";
import { applyLabel } from "./labels";
import type { LabelDecision, LabelRequest } from "./radar-page-types";

// applyLabel against real Postgres (pglite). Covers plan ENG-D12 (R-labelorder:
// identity order, request id, stale check) and the DES-D6 `clear` decision.

let t: RadarTestDb;

beforeAll(async () => {
  t = await makeRadarTestDb();
});

afterAll(async () => {
  await t.close();
});

let n = 0;
async function candidate(status = "scored"): Promise<string> {
  n += 1;
  const r = await t.client.query<{ id: string }>(
    `INSERT INTO news_candidate (source_url, title, published_at, status)
     VALUES ($1, $2, now(), $3) RETURNING id`,
    [`https://example.test/label-${n}`, `Item ${n}`, status],
  );
  return r.rows[0].id;
}

async function rows(id: string) {
  const r = await t.client.query<{ id: string; decision: string; request_id: string | null }>(
    `SELECT id, decision, request_id FROM news_candidate_label WHERE candidate_id = $1 ORDER BY sequence`,
    [id],
  );
  return r.rows;
}

const req = (decision: LabelDecision, extra: Partial<LabelRequest> = {}): LabelRequest => ({
  decision,
  requestId: randomUUID(),
  ...extra,
});

// Narrow a result the test expects to be ok; fails loudly otherwise.
async function ok(id: string, input: LabelRequest) {
  const res = await applyLabel(t.db, id, input);
  if (res.kind !== "ok") throw new Error(`expected ok, got ${res.kind}`);
  return res;
}

describe("applyLabel writes", () => {
  it("first keep writes one row and reports it as current and newest", async () => {
    const id = await candidate();
    const res = await ok(id, req("keep"));
    const [row] = await rows(id);

    expect(row.decision).toBe("keep");
    expect(res).toEqual({
      kind: "ok",
      label: { id: row.id, decision: "keep" },
      latestLabelId: row.id,
      changed: true,
    });
  });

  it("switching keep to skip appends a second row; history is kept", async () => {
    const id = await candidate();
    const first = await ok(id, req("keep"));
    const second = await ok(id, req("skip"));

    expect(second.changed).toBe(true);
    expect(second.label).toEqual({ id: second.latestLabelId, decision: "skip" });
    expect(second.latestLabelId).not.toBe(first.latestLabelId);
    expect((await rows(id)).map((r) => r.decision)).toEqual(["keep", "skip"]);
  });

  it("clear un-labels but the clear row is the newest row; a relabel then counts", async () => {
    const id = await candidate();
    await ok(id, req("keep"));
    const cleared = await ok(id, req("clear"));
    expect(cleared.label).toBeNull();
    expect(cleared.changed).toBe(true);
    const clearRow = (await rows(id))[1];
    expect(cleared.latestLabelId).toBe(clearRow.id);

    const relabelled = await ok(id, req("skip"));
    expect(relabelled.label).toEqual({ id: relabelled.latestLabelId, decision: "skip" });
    expect((await rows(id)).map((r) => r.decision)).toEqual(["keep", "clear", "skip"]);
  });

  it("the same decision twice writes one row", async () => {
    const id = await candidate();
    const first = await ok(id, req("keep"));
    const again = await ok(id, req("keep"));

    expect(again).toEqual({ ...first, changed: false });
    expect(await rows(id)).toHaveLength(1);
  });

  it("clear on an unlabelled item, or after a clear, writes nothing", async () => {
    const id = await candidate();
    const none = await ok(id, req("clear"));
    expect(none).toEqual({ kind: "ok", label: null, latestLabelId: null, changed: false });
    expect(await rows(id)).toHaveLength(0);

    await ok(id, req("keep"));
    await ok(id, req("clear"));
    const twice = await ok(id, req("clear"));
    expect(twice.changed).toBe(false);
    expect(await rows(id)).toHaveLength(2);
  });

  it("latest means the highest sequence, even when created_at ties", async () => {
    const id = await candidate();
    // One statement: both rows share created_at; only the identity orders them.
    await t.client.query(
      `INSERT INTO news_candidate_label (candidate_id, decision) VALUES ($1, 'keep'), ($1, 'skip')`,
      [id],
    );
    const [, skipRow] = await rows(id);

    const same = await ok(id, req("skip"));
    expect(same).toEqual({
      kind: "ok",
      label: { id: skipRow.id, decision: "skip" },
      latestLabelId: skipRow.id,
      changed: false,
    });
    expect((await ok(id, req("keep"))).changed).toBe(true);
  });
});

describe("applyLabel request id", () => {
  it("a replayed request id returns the item's current state and writes no row", async () => {
    const id = await candidate();
    const first = req("keep");
    await ok(id, first);
    const skip = await ok(id, req("skip"));

    // Stale ifLatestLabelId on the replay must not turn a landed retry into a conflict.
    const replay = await ok(id, { ...first, ifLatestLabelId: null });
    expect(replay).toEqual({ ...skip, changed: false });
    expect(await rows(id)).toHaveLength(2);
  });

  it("the same id for another decision or another item is request-id-reused, nothing written", async () => {
    const a = await candidate();
    const b = await candidate();
    const used = req("keep");
    await ok(a, used);

    expect(await applyLabel(t.db, a, { ...used, decision: "skip" })).toEqual({ kind: "request-id-reused" });
    expect(await applyLabel(t.db, b, used)).toEqual({ kind: "request-id-reused" });
    expect(await rows(a)).toHaveLength(1);
    expect(await rows(b)).toHaveLength(0);
  });
});

describe("applyLabel stale check", () => {
  it("a late old Keep after a newer Skip conflicts with the current label and changes nothing", async () => {
    const id = await candidate();
    const skip = await ok(id, req("skip"));

    // The page last saw no label (null), so its Keep is stale.
    const late = await applyLabel(t.db, id, req("keep", { ifLatestLabelId: null }));
    expect(late).toEqual({ kind: "conflict", current: skip.label, latestLabelId: skip.latestLabelId });
    expect((await rows(id)).map((r) => r.decision)).toEqual(["skip"]);
  });

  it("a matching ifLatestLabelId proceeds", async () => {
    const id = await candidate();
    const keep = await ok(id, req("keep"));
    const res = await ok(id, req("skip", { ifLatestLabelId: keep.latestLabelId }));

    expect(res.changed).toBe(true);
    expect(res.label?.decision).toBe("skip");
  });

  it("null matches an unlabelled item and conflicts on a labelled one", async () => {
    const id = await candidate();
    expect((await ok(id, req("keep", { ifLatestLabelId: null }))).changed).toBe(true);
    expect((await applyLabel(t.db, id, req("skip", { ifLatestLabelId: null }))).kind).toBe("conflict");
    expect(await rows(id)).toHaveLength(1);
  });

  it("compares against the newest row, clear included", async () => {
    const id = await candidate();
    const keep = await ok(id, req("keep"));
    const cleared = await ok(id, req("clear"));

    // A client that saw the clear row's id is current, not conflicting.
    const fresh = await ok(id, req("skip", { ifLatestLabelId: cleared.latestLabelId }));
    expect(fresh.changed).toBe(true);

    // The earlier keep id is stale once anything newer exists.
    const stale = await applyLabel(t.db, id, req("keep", { ifLatestLabelId: keep.latestLabelId }));
    expect(stale.kind).toBe("conflict");
  });

  it("the check runs before the same-decision shortcut, and an omitted id skips it", async () => {
    const id = await candidate();
    await ok(id, req("keep"));
    const stale = await applyLabel(t.db, id, req("keep", { ifLatestLabelId: randomUUID() }));
    expect(stale.kind).toBe("conflict");
    expect((await ok(id, req("keep"))).changed).toBe(false);
  });
});

describe("applyLabel unhappy paths", () => {
  it("an unknown candidate is not-found", async () => {
    expect(await applyLabel(t.db, randomUUID(), req("keep"))).toEqual({ kind: "not-found" });
  });

  it.each(["new", "unscored", "failed"])("a %s candidate is not-scored and nothing is written", async (status) => {
    const id = await candidate(status);
    expect(await applyLabel(t.db, id, req("keep"))).toEqual({ kind: "not-scored" });
    expect(await rows(id)).toHaveLength(0);
  });

  it("an unexpected database error propagates instead of being swallowed", async () => {
    await expect(applyLabel(t.db, "not-a-uuid", req("keep"))).rejects.toThrow();
  });
});

describe("applyLabel concurrency", () => {
  // pglite is one connection, so these prove the outcome is consistent when two
  // calls overlap, not that Postgres row locks work; the lock itself is checked
  // by the SQL test below.
  it("two overlapping first labels with ifLatestLabelId null: one wins, one conflicts", async () => {
    const id = await candidate();
    const [a, b] = await Promise.all([
      applyLabel(t.db, id, req("keep", { ifLatestLabelId: null })),
      applyLabel(t.db, id, req("skip", { ifLatestLabelId: null })),
    ]);

    expect([a.kind, b.kind].sort()).toEqual(["conflict", "ok"]);
    expect(await rows(id)).toHaveLength(1);
  });

  it("two overlapping calls with one request id write one row", async () => {
    const id = await candidate();
    const same = req("keep");
    const [a, b] = await Promise.all([applyLabel(t.db, id, same), applyLabel(t.db, id, same)]);

    expect([a, b].map((r) => r.kind === "ok" && r.changed).sort()).toEqual([false, true]);
    expect(await rows(id)).toHaveLength(1);
  });

  it("locks the candidate row before reading its labels", async () => {
    const queries: string[] = [];
    const logged = drizzle(t.client, {
      schema,
      logger: { logQuery: (q) => void queries.push(q) },
    }) as unknown as DB;

    await applyLabel(logged, await candidate(), req("keep"));

    const lock = queries.findIndex((q) => /from "news_candidate"[\s\S]*for update/i.test(q));
    const read = queries.findIndex((q) => /from "news_candidate_label"/i.test(q));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(read);
  });
});
