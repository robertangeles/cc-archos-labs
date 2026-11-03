// Real-Postgres proof of the two concurrency guarantees in lib/x-articles/queue.ts
// that pglite cannot show: a replaced worker's late write matches nothing, and a
// second worker skips a row another worker is claiming instead of waiting for it.
// pglite is single-connection and CI has no Postgres, so this file is skipped
// unless REAL_PG_URL is set, and refuses any host but this machine.
//
// Run (DEV Postgres only, after migration 0046 is applied there):
//   ( set -a; . ./.env.local; set +a; REAL_PG_URL="$DATABASE_URL" pnpm vitest run tests/real-pg/x-article-queue.real-pg.test.ts )
//
// It works in a throwaway schema (a copy of the queue table with its CHECKs and
// indexes, and a minimal post table), dropped afterwards, so no DEV row is touched.
//
// Deterministic, no sleeps: a second connection plays the other worker and holds
// the row inside an open transaction, and we poll pg_stat_activity until the
// module's query is blocked by that connection's pid.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../lib/db/schema";
import type { DB } from "../../lib/db";
import { claimBatch, saveDraft } from "../../lib/x-articles/queue";

const REAL_PG_URL = process.env.REAL_PG_URL;
const LEASE = 2 * 60_000;

describe.skipIf(!REAL_PG_URL)("x_article_publication queue (real Postgres)", () => {
  const schemaName = `x_queue_proof_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const appName = `x-queue-proof-${schemaName}`;
  let admin: postgres.Sql;
  let holderConn: postgres.Sql;
  let observer: postgres.Sql;
  let appClient: postgres.Sql;
  let db: DB;

  beforeAll(async () => {
    const host = new URL(REAL_PG_URL!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(`REAL_PG_URL host must be 127.0.0.1 or localhost, got "${host}". DEV only.`);
    }
    admin = postgres(REAL_PG_URL!, { max: 1, onnotice: () => undefined });
    holderConn = postgres(REAL_PG_URL!, { max: 1 });
    observer = postgres(REAL_PG_URL!, { max: 1 });
    await admin.unsafe(`CREATE SCHEMA ${schemaName}`);
    await admin.unsafe(
      `CREATE TABLE ${schemaName}.post (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'published',
         visibility text NOT NULL DEFAULT 'listed', archived_at timestamptz, published_at timestamptz DEFAULT now())`,
    );
    await admin.unsafe(
      `CREATE TABLE ${schemaName}.x_article_publication (LIKE public.x_article_publication INCLUDING ALL)`,
    );

    // The app's pool: the queue module's unqualified table names resolve to the scratch schema.
    appClient = postgres(REAL_PG_URL!, { max: 4, connection: { search_path: schemaName, application_name: appName } });
    db = drizzle(appClient, { schema }) as unknown as DB;
  }, 20_000);

  afterAll(async () => {
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await Promise.all([admin?.end(), holderConn?.end(), observer?.end(), appClient?.end()]);
  }, 20_000);

  async function waitUntilBlockedBy(blockerPid: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await observer`
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = ${appName}
          AND wait_event_type = 'Lock'
          AND ${blockerPid} = ANY(pg_blocking_pids(pid))`;
      if (rows.length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  async function queuedRow() {
    const [p] = await admin.unsafe(`INSERT INTO ${schemaName}.post DEFAULT VALUES RETURNING id`);
    const [r] = await admin.unsafe(
      `INSERT INTO ${schemaName}.x_article_publication (post_id) VALUES ('${p.id}') RETURNING id`,
    );
    return r.id as string;
  }

  const readRow = async (id: string) =>
    (await admin.unsafe(`SELECT status, claimed_by, article_id FROM ${schemaName}.x_article_publication WHERE id = '${id}'`))[0];

  it("a replaced worker's late write waits for the new owner, then matches nothing", async () => {
    const id = await queuedRow();
    const [a] = await claimBatch(db, { now: new Date(), leaseMs: LEASE, limit: 1, claimDrafted: false });
    expect(a.id).toBe(id);

    // Worker B takes the row over (what recoverStale then claimBatch do) and has not committed yet.
    const b = randomUUID();
    const [{ pid }] = await holderConn<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await holderConn.unsafe("BEGIN");
    let committed = false;
    let lateWrite: Promise<boolean> | undefined;
    try {
      await holderConn.unsafe(
        `UPDATE ${schemaName}.x_article_publication SET claimed_by = '${b}', attempts = attempts + 1 WHERE id = '${id}'`,
      );

      // A's lease expired but A did not notice: its write reaches the database now.
      lateWrite = saveDraft(db, a, { articleId: "2117512156132618240", coverStatus: "none" }, new Date());
      expect(await waitUntilBlockedBy(pid), "A's write should wait on B's row lock").toBe(true);

      await holderConn.unsafe("COMMIT");
      committed = true;
      // Re-checked after the lock is released, A's fence no longer matches: B owns the row.
      expect(await lateWrite).toBe(false);
    } finally {
      if (!committed) await holderConn.unsafe("ROLLBACK").catch(() => undefined);
      await lateWrite?.catch(() => undefined);
    }

    expect(await readRow(id)).toMatchObject({ status: "working", claimed_by: b, article_id: null });
  }, 20_000);

  it("a second worker skips a row another worker is claiming instead of waiting, and only one wins", async () => {
    const id = await queuedRow();
    // Worker A is mid-claim: it holds the row lock inside an open transaction.
    await holderConn.unsafe("BEGIN");
    let committed = false;
    try {
      await holderConn.unsafe(`SELECT id FROM ${schemaName}.x_article_publication WHERE id = '${id}' FOR UPDATE`);

      // Worker B must not wait for A: SKIP LOCKED hands B an empty batch at once. The timeout
      // only bounds the failure case, where B blocks until A commits.
      const answer = await Promise.race([
        claimBatch(db, { now: new Date(), leaseMs: LEASE, limit: 1, claimDrafted: false }),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 3_000)),
      ]);
      expect(answer, "B should skip the locked row, not wait for it").toEqual([]);

      await holderConn.unsafe(
        `UPDATE ${schemaName}.x_article_publication SET status = 'working', claimed_by = '${randomUUID()}', claimed_until = now() + interval '2 minutes' WHERE id = '${id}'`,
      );
      await holderConn.unsafe("COMMIT");
      committed = true;
    } finally {
      if (!committed) await holderConn.unsafe("ROLLBACK").catch(() => undefined);
    }

    // A won; the row is working under a live lease, so B has nothing to take.
    expect(await claimBatch(db, { now: new Date(), leaseMs: LEASE, limit: 1, claimDrafted: false })).toEqual([]);
  }, 20_000);
});
