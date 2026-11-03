import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../../lib/db/schema";
import type { DB } from "../../../../lib/db";

// POST /api/cron/process-scheduled-posts: characterization test. It pins what the
// route does today (auth, heartbeat, response shape) so a later edit to the route
// cannot change it silently. The publisher itself is covered by
// lib/posts-admin/scheduled-publisher.test.ts; here it is a fake.

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../../../lib/db", () => ({ getDb: () => holder.db }));

const publishScheduledPosts = vi.fn();
vi.mock("../../../../lib/posts-admin/scheduled-publisher", () => ({
  publishScheduledPosts: (...a: unknown[]) => publishScheduledPosts(...a),
}));

const { POST } = await import("./route");

const SECRET = "a-long-enough-cron-secret-123";

let client: PGlite;
let realDb: DB;

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
  realDb = drizzle(client, { schema }) as unknown as DB;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec("DELETE FROM cron_heartbeat");
  holder.db = realDb;
  publishScheduledPosts.mockReset();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const call = (headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) =>
  POST(new NextRequest("http://localhost/api/cron/process-scheduled-posts", { method: "POST", headers }));

const result = (over: Record<string, unknown> = {}) => ({
  ok: true,
  processed: 3,
  published: 2,
  raced: 1,
  failed: 0,
  details: [
    { id: "a", outcome: "published" },
    { id: "b", outcome: "published" },
    { id: "c", outcome: "raced" },
  ],
  ...over,
});

async function heartbeatRows() {
  const r = await client.query<{
    id: string;
    last_run_jobs_processed: number;
    last_run_jobs_failed: number;
    last_run_duration_ms: number | null;
  }>("SELECT id, last_run_jobs_processed, last_run_jobs_failed, last_run_duration_ms FROM cron_heartbeat");
  return r.rows;
}

// A db whose every entry point throws, so any database work fails loudly.
const explodingDb = (calls: string[]) =>
  new Proxy(
    {},
    {
      get: (_t, prop) => {
        calls.push(String(prop));
        throw new Error("db down");
      },
    },
  ) as unknown as DB;

describe("CRON_SECRET not configured", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["15 characters", "x".repeat(15)],
  ])("503 and no database or publisher work when %s", async (_label, value) => {
    vi.stubEnv("CRON_SECRET", value);
    const calls: string[] = [];
    holder.db = explodingDb(calls);

    // Even a request that would match the secret is refused before anything runs.
    const res = await call({ authorization: `Bearer ${value ?? ""}` });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "Cron not configured." });
    expect(publishScheduledPosts).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("a 16 character secret is long enough", async () => {
    const secret = "x".repeat(16);
    vi.stubEnv("CRON_SECRET", secret);
    publishScheduledPosts.mockResolvedValue(result());
    expect((await call({ authorization: `Bearer ${secret}` })).status).toBe(200);
  });
});

describe("authorization", () => {
  it.each([
    ["no Authorization header", {}],
    ["a non-Bearer header", { authorization: SECRET }],
    ["a Basic header", { authorization: `Basic ${SECRET}` }],
    ["a same-length wrong token", { authorization: `Bearer ${"z".repeat(SECRET.length)}` }],
    ["a shorter wrong token", { authorization: "Bearer nope" }],
    ["a longer wrong token", { authorization: `Bearer ${SECRET}-extra` }],
    ["an empty Bearer token", { authorization: "Bearer " }],
  ])("401 and no publisher call for %s", async (_label, headers) => {
    const calls: string[] = [];
    holder.db = explodingDb(calls);

    const res = await call(headers);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" });
    expect(publishScheduledPosts).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("publisher throws", () => {
  it("writes heartbeat processed 0 / failed 1 and answers 503 with the message", async () => {
    publishScheduledPosts.mockRejectedValue(new Error("publisher exploded"));

    const res = await call();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "Publisher failed.", detail: "publisher exploded" });
    const rows = await heartbeatRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "posts-publisher",
      last_run_jobs_processed: 0,
      last_run_jobs_failed: 1,
    });
    expect(rows[0].last_run_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("stringifies a non-Error throw into detail", async () => {
    publishScheduledPosts.mockRejectedValue("plain string");
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "Publisher failed.", detail: "plain string" });
  });
});

describe("publisher succeeds", () => {
  it("writes heartbeat processed = published, failed = failed and mirrors the result with 200", async () => {
    const r = result();
    publishScheduledPosts.mockResolvedValue(r);

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      processed: r.processed,
      published: r.published,
      raced: r.raced,
      failed: r.failed,
      details: r.details,
    });
    expect(publishScheduledPosts).toHaveBeenCalledTimes(1);
    expect(publishScheduledPosts.mock.calls[0][0]).toBeInstanceOf(Date);
    const rows = await heartbeatRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "posts-publisher",
      last_run_jobs_processed: 2,
      last_run_jobs_failed: 0,
    });
    expect(rows[0].last_run_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("with failures: heartbeat counts them, body carries ok:false, status is still 200", async () => {
    const r = result({
      ok: false,
      processed: 3,
      published: 1,
      raced: 0,
      failed: 2,
      details: [
        { id: "a", outcome: "published" },
        { id: "b", outcome: "failed", detail: "boom" },
        { id: "c", outcome: "failed", detail: "bang" },
      ],
    });
    publishScheduledPosts.mockResolvedValue(r);

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      processed: 3,
      published: 1,
      raced: 0,
      failed: 2,
      details: r.details,
    });
    expect((await heartbeatRows())[0]).toMatchObject({
      id: "posts-publisher",
      last_run_jobs_processed: 1,
      last_run_jobs_failed: 2,
    });
  });

  it("a second run updates the existing heartbeat row instead of inserting another", async () => {
    publishScheduledPosts.mockResolvedValueOnce(result({ published: 2, failed: 0 }));
    publishScheduledPosts.mockResolvedValueOnce(result({ ok: false, published: 5, failed: 4 }));

    await call();
    await call();

    const rows = await heartbeatRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "posts-publisher",
      last_run_jobs_processed: 5,
      last_run_jobs_failed: 4,
    });
  });
});

describe("heartbeat write failure is swallowed", () => {
  it("still returns the normal success response when the heartbeat cannot be written", async () => {
    const r = result();
    publishScheduledPosts.mockResolvedValue(r);
    const calls: string[] = [];
    holder.db = explodingDb(calls);

    const res = await call();

    expect(calls.length).toBeGreaterThan(0); // the route did try to write it
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      processed: r.processed,
      published: r.published,
      raced: r.raced,
      failed: r.failed,
      details: r.details,
    });
  });

  it("still returns the 503 publisher-failed response when the heartbeat cannot be written", async () => {
    publishScheduledPosts.mockRejectedValue(new Error("publisher exploded"));
    holder.db = explodingDb([]);

    const res = await call();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "Publisher failed.", detail: "publisher exploded" });
  });

  it("swallows a failure on the write itself, not only on getDb", async () => {
    publishScheduledPosts.mockResolvedValue(result());
    holder.db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({
        values: async () => {
          throw new Error("insert failed");
        },
      }),
    } as unknown as DB;

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).published).toBe(2);
  });
});
