import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./db/schema";
import type { DB } from "./db";
import { readHeartbeat, touchHeartbeat } from "./cron-heartbeat";

// Proves the shared heartbeat helper upserts one row per cron id and reads it
// back, against real Postgres (pglite). The table is the same shape as
// lib/db/schema.ts cronHeartbeat.

let client: PGlite;
let db: DB;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(`
    CREATE TABLE cron_heartbeat (
      id text PRIMARY KEY,
      last_run_at timestamptz NOT NULL,
      last_run_jobs_processed integer NOT NULL DEFAULT 0,
      last_run_jobs_failed integer NOT NULL DEFAULT 0,
      last_run_duration_ms integer,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  db = drizzle(client, { schema }) as unknown as DB;
});

afterAll(async () => {
  await client.close();
});

describe("cron heartbeat helper", () => {
  it("reads null for a cron that has never run", async () => {
    expect(await readHeartbeat("never-ran", db)).toBeNull();
  });

  it("inserts on first touch and reads it back", async () => {
    await touchHeartbeat("news-radar", { processed: 7, failed: 1, durationMs: 1234 }, db);
    const hb = await readHeartbeat("news-radar", db);
    expect(hb).toMatchObject({ processed: 7, failed: 1, durationMs: 1234 });
    expect(Date.now() - hb!.lastRunAt.getTime()).toBeLessThan(10_000);
  });

  it("updates the same row on the next touch (one row per id)", async () => {
    await touchHeartbeat("news-radar", { processed: 2, failed: 0, durationMs: 50 }, db);
    expect(await readHeartbeat("news-radar", db)).toMatchObject({ processed: 2, failed: 0, durationMs: 50 });
    const rows = await client.query(`SELECT id FROM cron_heartbeat WHERE id = 'news-radar'`);
    expect(rows.rows).toHaveLength(1);
  });

  it("keeps ids independent", async () => {
    await touchHeartbeat("other-cron", { processed: 9, failed: 9, durationMs: 9 }, db);
    expect(await readHeartbeat("news-radar", db)).toMatchObject({ processed: 2 });
  });

  it("swallows a write failure and logs it, so the cron's own work is not failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { insert: () => { throw new Error("db down"); } } as unknown as DB;
    await expect(touchHeartbeat("news-radar", { processed: 1, failed: 0, durationMs: 1 }, broken)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
