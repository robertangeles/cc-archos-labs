import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRadarTestDb, type RadarTestDb } from "../../tests/helpers/radar-test-db";
import { claimBatch, isNewsRadarEnabled, runTick, type TickDeps } from "./radar";
import { JevAuthError, JevRateLimitError, JevShapeError, type CuratorResult } from "./curator";
import { FeedFetchError, type FeedEntry } from "./feed";

// runTick against real Postgres (pglite). The feed, Jev and the embedding are
// fakes; everything that touches the database is the real code path.

let t: RadarTestDb;

beforeAll(async () => {
  t = await makeRadarTestDb();
  await t.client.exec(`
    CREATE TABLE site_setting (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL UNIQUE,
      value jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.client.exec(`
    DELETE FROM news_candidate_score; DELETE FROM news_candidate_label;
    DELETE FROM news_candidate; DELETE FROM news_radar_tick;
    DELETE FROM news_radar_rubric; DELETE FROM site_setting;`);
});

const SLOT = new Date("2026-10-26T04:00:00Z");
const T0 = new Date("2026-10-26T04:05:00Z");

const RUBRIC = {
  model: "jev-1.14.0",
  questions: {
    audience_fit: {
      instructions: "How useful is this to a data and AI leader in a regulated industry?",
      criteria: ["Irrelevant", "Passing interest", "Useful context", "Directly affects their program"],
    },
  },
  cutoffs: { audienceFit: 2, confidence: 0.6, minNoveltyDistance: 0.3, dailyCap: 3 },
};

async function addRubric(config: unknown = RUBRIC): Promise<number> {
  const r = await t.client.query<{ version: number }>(
    `INSERT INTO news_radar_rubric (config) VALUES ($1::jsonb) RETURNING version`,
    [JSON.stringify(config)],
  );
  return r.rows[0].version;
}

const entry = (n: number): FeedEntry => ({
  sourceUrl: `https://huggingnews.com/ai/item-${n}`,
  title: `Item ${n}`,
  summary: `Summary ${n}`,
  category: "ai",
  publishedAt: new Date(`2026-10-25T0${n}:00:00Z`),
});

const jevResult = (): CuratorResult => ({
  model: "jev-1.14.0",
  answers: [
    {
      questionKey: "audience_fit",
      model: "jev-1.14.0",
      score: 2.5,
      confidence: 0.9,
      probabilities: { "0": 0, "1": 0.1, "2": 0.4, "3": 0.5 },
    },
  ],
});

interface Harness {
  deps: TickDeps;
  score: ReturnType<typeof vi.fn>;
  feed: ReturnType<typeof vi.fn>;
  clock: { at: Date };
}

function harness(over: Partial<TickDeps> = {}, entries: FeedEntry[] = [entry(1), entry(2), entry(3)]): Harness {
  const score = vi.fn(async () => jevResult());
  const feed = vi.fn(async () => ({ entries, skipped: 0 }));
  const clock = { at: new Date(T0) };
  let n = 0;
  const deps: TickDeps = {
    db: t.db,
    isEnabled: async () => true,
    getApiKey: async () => "test-key",
    fetchFeed: feed as unknown as TickDeps["fetchFeed"],
    scoreCandidate: score as unknown as TickDeps["scoreCandidate"],
    novelty: async () => 0.8,
    now: () => clock.at,
    newToken: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    ...over,
  };
  return { deps, score, feed, clock };
}

const q = async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await t.client.query<R>(sql, params)).rows;

describe("runTick: gates", () => {
  it("logs a disabled tick and touches neither the feed nor the key", async () => {
    await addRubric();
    const h = harness({ isEnabled: async () => false, getApiKey: vi.fn(async () => "k") });
    const r = await runTick(SLOT, h.deps);

    expect(r.outcome).toBe("disabled");
    expect(h.feed).not.toHaveBeenCalled();
    expect(h.deps.getApiKey).not.toHaveBeenCalled();
    expect(await q(`SELECT outcome FROM news_radar_tick`)).toEqual([{ outcome: "disabled" }]);
    expect(await q(`SELECT 1 FROM news_candidate`)).toHaveLength(0);
  });

  it("fails closed with no rubric", async () => {
    const h = harness();
    const r = await runTick(SLOT, h.deps);
    expect(r).toMatchObject({ outcome: "failed", errorClass: "NoRubric", rubricVersion: null });
    expect(h.feed).not.toHaveBeenCalled();
  });

  it("fails closed when the stored rubric is invalid", async () => {
    await addRubric({ nope: true });
    const r = await runTick(SLOT, harness().deps);
    expect(r).toMatchObject({ outcome: "failed", errorClass: "RubricInvalid" });
  });

  it("fails closed when no Jev key is stored, before reading the feed", async () => {
    await addRubric();
    const h = harness({ getApiKey: async () => null });
    const r = await runTick(SLOT, h.deps);
    expect(r).toMatchObject({ outcome: "failed", errorClass: "JevKeyMissing" });
    expect(h.feed).not.toHaveBeenCalled();
  });

  it("reads the flag from site_setting, defaulting to off", async () => {
    expect(await isNewsRadarEnabled(t.db)).toBe(false);
    await t.client.query(`INSERT INTO site_setting (key, value) VALUES ('news_radar_enabled', '{"enabled": "yes"}')`);
    expect(await isNewsRadarEnabled(t.db)).toBe(false);
    await t.client.query(`UPDATE site_setting SET value = '{"enabled": true}' WHERE key = 'news_radar_enabled'`);
    expect(await isNewsRadarEnabled(t.db)).toBe(true);
  });
});

describe("runTick: happy path", () => {
  it("stores new items, scores them under the pinned version and logs one ok tick", async () => {
    const version = await addRubric();
    const h = harness();
    const r = await runTick(SLOT, h.deps);

    expect(r).toEqual({
      outcome: "ok", fetched: 3, newCount: 3, scored: 3, unscored: 0, failedCount: 0,
      errorClass: null, rubricVersion: version,
    });
    const cands = await q<{ status: string; claimed_by: string | null; attempts: number }>(
      `SELECT status, claimed_by, attempts FROM news_candidate`,
    );
    expect(cands).toHaveLength(3);
    expect(cands.every((c) => c.status === "scored" && c.claimed_by === null && c.attempts === 1)).toBe(true);

    const scores = await q<{ question_key: string; model: string; score: number; confidence: number | null; rubric_version: number }>(
      `SELECT question_key, model, score, confidence, rubric_version FROM news_candidate_score ORDER BY question_key`,
    );
    expect(scores).toHaveLength(6);
    expect(scores.every((s) => s.rubric_version === version)).toBe(true);
    expect(scores.filter((s) => s.question_key === "audience_fit")[0]).toMatchObject({ model: "jev-1.14.0", score: 2.5, confidence: 0.9 });
    expect(scores.filter((s) => s.question_key === "novelty")[0]).toMatchObject({ model: "embedding-nearest-post", score: 0.8, confidence: null });

    expect(await q(`SELECT outcome, fetched, new_count, scored, rubric_version FROM news_radar_tick`)).toEqual([
      { outcome: "ok", fetched: 3, new_count: 3, scored: 3, rubric_version: version },
    ]);
  });

  it("does not store or rescore items it has already seen", async () => {
    await addRubric();
    const h = harness();
    await runTick(SLOT, h.deps);
    const r = await runTick(new Date("2026-10-26T06:00:00Z"), h.deps);

    expect(r).toMatchObject({ outcome: "ok", fetched: 3, newCount: 0, scored: 0 });
    expect(h.score).toHaveBeenCalledTimes(3);
    expect(await q(`SELECT 1 FROM news_candidate`)).toHaveLength(3);
    expect(await q(`SELECT 1 FROM news_radar_tick`)).toHaveLength(2);
  });

  it("scores an item that has left the feed", async () => {
    await addRubric();
    await q(`INSERT INTO news_candidate (source_url, title, published_at) VALUES ('https://huggingnews.com/ai/gone', 'Gone', now())`);
    const h = harness({}, []);
    const r = await runTick(SLOT, h.deps);
    expect(r).toMatchObject({ outcome: "ok", fetched: 0, scored: 1 });
  });

  it("scores without novelty when it cannot be measured, leaving the item ineligible", async () => {
    await addRubric();
    const r = await runTick(SLOT, harness({ novelty: async () => null }, [entry(1)]).deps);
    expect(r.scored).toBe(1);
    expect((await q(`SELECT question_key FROM news_candidate_score`)).map((s) => s.question_key)).toEqual(["audience_fit"]);
  });

  it("never writes a label", async () => {
    await addRubric();
    await runTick(SLOT, harness().deps);
    const [c] = await q<{ id: string }>(`SELECT id FROM news_candidate LIMIT 1`);
    await q(`INSERT INTO news_candidate_label (candidate_id, decision) VALUES ($1, 'keep')`, [c.id]);
    await runTick(new Date("2026-10-26T06:00:00Z"), harness().deps);
    expect(await q(`SELECT decision FROM news_candidate_label`)).toEqual([{ decision: "keep" }]);
  });
});

describe("runTick: rubric pin", () => {
  it("writes the version it loaded at the start even if a newer one is added mid-tick", async () => {
    const v1 = await addRubric();
    const h = harness();
    h.score.mockImplementationOnce(async () => {
      await addRubric(); // a new version appears while this tick is running
      return jevResult();
    });
    const r = await runTick(SLOT, h.deps);
    expect(r.rubricVersion).toBe(v1);
    const versions = await q<{ rubric_version: number }>(`SELECT DISTINCT rubric_version FROM news_candidate_score`);
    expect(versions).toEqual([{ rubric_version: v1 }]);
  });
});

describe("runTick: Jev failures", () => {
  it("stops on an auth error, fails the tick and gives every claimed item back untouched", async () => {
    await addRubric();
    const h = harness();
    h.score.mockRejectedValue(new JevAuthError("Jev rejected the API key (401)."));
    const r = await runTick(SLOT, h.deps);

    expect(r).toMatchObject({ outcome: "failed", errorClass: "JevAuthError", scored: 0 });
    expect(h.score).toHaveBeenCalledTimes(1);
    const rows = await q<{ status: string; attempts: number; claimed_by: string | null }>(`SELECT status, attempts, claimed_by FROM news_candidate`);
    expect(rows).toHaveLength(3);
    expect(rows.every((c) => c.status === "new" && c.attempts === 0 && c.claimed_by === null)).toBe(true);
    expect(await q(`SELECT 1 FROM news_candidate_score`)).toHaveLength(0);
  });

  it("stops on exhausted rate limits, keeping what it already scored", async () => {
    await addRubric();
    const h = harness();
    h.score.mockResolvedValueOnce(jevResult());
    h.score.mockRejectedValueOnce(new JevRateLimitError("Jev is rate limiting (429)."));
    const r = await runTick(SLOT, h.deps);

    expect(r).toMatchObject({ outcome: "partial", errorClass: "JevRateLimitError", scored: 1 });
    expect(Number((await q<{ n: number }>(`SELECT count(*) n FROM news_candidate WHERE status = 'scored'`))[0].n)).toBe(1);
    expect(Number((await q<{ n: number }>(`SELECT count(*) n FROM news_candidate WHERE status = 'new' AND attempts = 0`))[0].n)).toBe(2);
  });

  it("marks one bad answer unscored, scores the rest, and reports a partial tick", async () => {
    await addRubric();
    const h = harness();
    h.score.mockResolvedValueOnce(jevResult());
    h.score.mockRejectedValueOnce(new JevShapeError("Jev returned an unexpected answer shape."));
    h.score.mockResolvedValueOnce(jevResult());
    const r = await runTick(SLOT, h.deps);

    expect(r).toMatchObject({ outcome: "partial", scored: 2, unscored: 1, failedCount: 0 });
    const bad = await q<{ status: string; attempts: number; last_error: string }>(`SELECT status, attempts, last_error FROM news_candidate WHERE status = 'unscored'`);
    expect(bad).toEqual([{ status: "unscored", attempts: 1, last_error: "JevShapeError" }]);
  });

  it("retries an unscored item on the next tick and retires it as failed after the attempt limit", async () => {
    await addRubric();
    const h = harness({}, [entry(1)]);
    h.score.mockRejectedValue(new JevShapeError("bad"));

    const r1 = await runTick(new Date("2026-10-26T04:00:00Z"), h.deps);
    const r2 = await runTick(new Date("2026-10-26T06:00:00Z"), h.deps);
    const r3 = await runTick(new Date("2026-10-26T08:00:00Z"), h.deps);
    expect([r1.unscored, r2.unscored, r3.unscored, r3.failedCount]).toEqual([1, 1, 0, 1]);

    const r4 = await runTick(new Date("2026-10-26T10:00:00Z"), h.deps);
    expect(r4).toMatchObject({ scored: 0, unscored: 0, failedCount: 0 });
    expect(h.score).toHaveBeenCalledTimes(3);
    expect(await q(`SELECT status, attempts FROM news_candidate`)).toEqual([{ status: "failed", attempts: 3 }]);
  });

  it("stops after several bad answers in a row and returns the untried items", async () => {
    await addRubric();
    const h = harness({}, [entry(1), entry(2), entry(3), entry(4), entry(5)]);
    h.score.mockRejectedValue(new JevShapeError("bad"));
    const r = await runTick(SLOT, h.deps);

    expect(r).toMatchObject({ outcome: "partial", unscored: 3, errorClass: "JevShapeError" });
    expect(h.score).toHaveBeenCalledTimes(3);
    expect(Number((await q<{ n: number }>(`SELECT count(*) n FROM news_candidate WHERE status = 'new' AND attempts = 0`))[0].n)).toBe(2);
  });

  it("lets an unexpected (non-Jev) error crash the tick without writing a tick row", async () => {
    await addRubric();
    const h = harness();
    h.score.mockRejectedValue(new TypeError("boom"));
    await expect(runTick(SLOT, h.deps)).rejects.toThrow("boom");
    expect(await q(`SELECT 1 FROM news_radar_tick`)).toHaveLength(0);
  });
});

describe("runTick: feed failures", () => {
  it("fails the tick but still scores the waiting backlog", async () => {
    await addRubric();
    await q(`INSERT INTO news_candidate (source_url, title, published_at) VALUES ('https://huggingnews.com/ai/waiting', 'Waiting', now())`);
    const h = harness({}, []);
    h.feed.mockRejectedValue(new FeedFetchError("feed returned HTTP 503"));
    const r = await runTick(SLOT, h.deps);

    expect(r).toMatchObject({ outcome: "failed", errorClass: "FeedFetchError", scored: 1 });
    expect(await q(`SELECT outcome, error_class FROM news_radar_tick`)).toEqual([{ outcome: "failed", error_class: "FeedFetchError" }]);
  });
});

describe("runTick: claims and the time budget", () => {
  it("discards a stale tick's commit after its claim was taken over", async () => {
    await addRubric();
    const OTHER = "99999999-9999-4999-8999-999999999999";
    const h = harness({}, [entry(1)]);
    h.score.mockImplementationOnce(async (item: { id: string }) => {
      // Tick B reclaims the item while tick A is waiting on Jev.
      await q(`UPDATE news_candidate SET claimed_by = $1, claimed_until = now() + interval '5 minutes' WHERE id = $2`, [OTHER, item.id]);
      return jevResult();
    });
    const r = await runTick(SLOT, h.deps);

    expect(r.scored).toBe(0);
    expect(await q(`SELECT 1 FROM news_candidate_score`)).toHaveLength(0);
    expect(await q(`SELECT status, claimed_by FROM news_candidate`)).toEqual([{ status: "scoring", claimed_by: OTHER }]);
  });

  it("does not hand the same items to a second claimer until the claim expires", async () => {
    await q(`INSERT INTO news_candidate (source_url, title, published_at) VALUES ('https://huggingnews.com/ai/x', 'X', now())`);
    const a = await claimBatch(t.db, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", T0, 25);
    const b = await claimBatch(t.db, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", T0, 25);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);

    const later = new Date(T0.getTime() + 6 * 60_000);
    const c = await claimBatch(t.db, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", later, 25);
    expect(c).toHaveLength(1);
    expect(c[0].attempts).toBe(2);
    expect(await q(`SELECT claimed_by FROM news_candidate`)).toEqual([{ claimed_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }]);
  });

  it("stops picking up items once the time budget is spent and returns the rest", async () => {
    await addRubric();
    const h = harness({ budgetMs: 50_000 });
    h.score.mockImplementation(async () => {
      h.clock.at = new Date(h.clock.at.getTime() + 40_000);
      return jevResult();
    });
    const r = await runTick(SLOT, h.deps);

    expect(r).toMatchObject({ outcome: "ok", scored: 2 });
    expect(Number((await q<{ n: number }>(`SELECT count(*) n FROM news_candidate WHERE status = 'new' AND attempts = 0`))[0].n)).toBe(1);
  });
});

describe("tick log", () => {
  it("lets a retry of a failed slot replace the row, and never downgrades an ok one", async () => {
    await addRubric();
    const failing = harness({}, []);
    failing.feed.mockRejectedValue(new FeedFetchError("feed returned HTTP 503"));
    await runTick(SLOT, failing.deps);
    expect(await q(`SELECT outcome FROM news_radar_tick`)).toEqual([{ outcome: "failed" }]);

    await runTick(SLOT, harness().deps);
    expect(await q(`SELECT outcome, scored FROM news_radar_tick`)).toEqual([{ outcome: "ok", scored: 3 }]);

    await runTick(SLOT, failing.deps);
    expect(await q(`SELECT outcome FROM news_radar_tick`)).toEqual([{ outcome: "ok" }]);
  });
});
