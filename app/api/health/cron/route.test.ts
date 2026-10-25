import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../../lib/db/schema";
import type { DB } from "../../../../lib/db";
import { makeRadarTestDb, type RadarTestDb } from "../../../../tests/helpers/radar-test-db";

// GET /api/health/cron
//
// 1. REGRESSION (the booking/posts monitor): with no ?id the response shape and
//    status codes must not change. UptimeRobot's check depends on them.
// 2. The news-radar id: heartbeat age, a frozen feed behind green ticks, and the
//    last tick's outcome. Unknown ids are rejected before any query runs.

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../../../lib/db", () => ({ getDb: () => holder.db }));

const { GET } = await import("./route");

let t: RadarTestDb;

beforeAll(async () => {
  t = await makeRadarTestDb();
  await t.client.exec(`
    CREATE TABLE cron_heartbeat (
      id text PRIMARY KEY,
      last_run_at timestamptz NOT NULL,
      last_run_jobs_processed integer NOT NULL DEFAULT 0,
      last_run_jobs_failed integer NOT NULL DEFAULT 0,
      last_run_duration_ms integer,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  holder.db = drizzle(t.client, { schema }) as unknown as DB;
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.client.exec(`DELETE FROM cron_heartbeat; DELETE FROM news_candidate_score; DELETE FROM news_candidate_label; DELETE FROM news_candidate; DELETE FROM news_radar_tick;`);
});

const call = (id?: string) =>
  GET(new Request(`http://localhost/api/health/cron${id === undefined ? "" : `?id=${encodeURIComponent(id)}`}`));

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

async function heartbeat(id: string, lastRunAt: string) {
  await t.client.query(
    `INSERT INTO cron_heartbeat (id, last_run_at, last_run_jobs_processed, last_run_jobs_failed, last_run_duration_ms)
     VALUES ($1, $2, 3, 1, 250)`,
    [id, lastRunAt],
  );
}

describe("default id (booking monitor) is unchanged", () => {
  it("503 and stale when the singleton heartbeat was never written", async () => {
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: true, lastRunAt: null, lastRunJobsProcessed: 0, lastRunJobsFailed: 0,
      lastRunDurationMs: null, stale: true, staleAfterMinutes: 10,
    });
  });

  it("200 with the heartbeat fields when fresh", async () => {
    const at = ago(2 * MIN);
    await heartbeat("singleton", at);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, lastRunAt: at, lastRunJobsProcessed: 3, lastRunJobsFailed: 1,
      lastRunDurationMs: 250, stale: false, staleAfterMinutes: 10,
    });
  });

  it("503 and stale when older than 10 minutes", async () => {
    await heartbeat("singleton", ago(11 * MIN));
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).stale).toBe(true);
  });

  it("500 with a plain message when the database read fails", async () => {
    const real = holder.db;
    holder.db = { select: () => { throw new Error("db down"); } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    holder.db = real;
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Could not read heartbeat." });
  });

  it("an explicit id=singleton behaves like the default", async () => {
    await heartbeat("singleton", ago(MIN));
    expect((await call("singleton")).status).toBe(200);
  });
});

describe("unknown ids", () => {
  it.each(["nope", "news-radar; drop table cron_heartbeat", "", "SINGLETON", "posts-publisher"])(
    "400 for %j without touching the database",
    async (id) => {
      const real = holder.db;
      holder.db = { select: () => { throw new Error("must not query"); } };
      const res = await call(id);
      holder.db = real;
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "Unknown cron id." });
    },
  );
});

async function newestItem(publishedAt: string) {
  await t.client.query(
    `INSERT INTO news_candidate (source_url, title, published_at, first_seen_at) VALUES ('https://example.test/' || gen_random_uuid(), 'T', $1, $1)`,
    [publishedAt],
  );
}

async function tick(outcome: string, slotAt: string, extra = "") {
  await t.client.query(
    `INSERT INTO news_radar_tick (slot_at, started_at, finished_at, outcome, fetched, new_count, scored, unscored, failed_count, error_class)
     VALUES ($1, $1, $1, $2, 20, 5, 4, 1, 0, ${extra ? `'${extra}'` : "NULL"})`,
    [slotAt, outcome],
  );
}

describe("id=news-radar", () => {
  it("503 and never-run when no heartbeat exists", async () => {
    const res = await call("news-radar");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: true, id: "news-radar", lastRunAt: null, stale: true });
  });

  it("200 when the heartbeat is fresh, the feed is moving and the last tick ran", async () => {
    await heartbeat("news-radar", ago(30 * MIN));
    await newestItem(ago(2 * HOUR));
    await tick("ok", ago(HOUR));
    const res = await call("news-radar");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true, id: "news-radar", stale: false, feedFrozen: false,
      lastTick: { outcome: "ok", fetched: 20, newCount: 5, scored: 4, unscored: 1, failedCount: 0, errorClass: null },
    });
  });

  it("503 and stale when the heartbeat is older than the limit", async () => {
    await heartbeat("news-radar", ago(6 * HOUR));
    await newestItem(ago(HOUR));
    await tick("ok", ago(6 * HOUR));
    const res = await call("news-radar");
    expect(res.status).toBe(503);
    expect((await res.json()).stale).toBe(true);
  });

  it("503 when ticks stay green but the feed has been frozen for over 12 hours", async () => {
    await heartbeat("news-radar", ago(10 * MIN));
    await newestItem(ago(13 * HOUR));
    await tick("ok", ago(10 * MIN));
    const res = await call("news-radar");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ stale: false, feedFrozen: true });
  });

  it("503 when the last tick failed, and names its error class", async () => {
    await heartbeat("news-radar", ago(10 * MIN));
    await newestItem(ago(HOUR));
    await tick("failed", ago(10 * MIN), "JevAuthError");
    const res = await call("news-radar");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ lastTick: { outcome: "failed", errorClass: "JevAuthError" } });
  });

  it("200 when the radar is deliberately disabled (alive, nothing to do)", async () => {
    await heartbeat("news-radar", ago(10 * MIN));
    await tick("disabled", ago(10 * MIN));
    const res = await call("news-radar");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lastTick: { outcome: "disabled" } });
  });

  it("500 with a plain message when the database read fails", async () => {
    const real = holder.db;
    holder.db = { select: () => { throw new Error("db down"); } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call("news-radar");
    holder.db = real;
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Could not read heartbeat." });
  });
});
