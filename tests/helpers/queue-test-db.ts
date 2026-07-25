import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../lib/db/schema";
import type { DB } from "../../lib/db";

// Ephemeral-Postgres harness for the blog agent's queue, against a REAL
// Postgres engine (pglite, in-process, no Docker).
//
// This one applies the ACTUAL migration file rather than a hand-written stub,
// so the tests validate drizzle/0036 itself: the table shape, the defaults,
// the FK constraints, and the indexes as production will get them. Only the
// two tables 0036 points its foreign keys at are stubbed, and only with the
// columns those constraints need — the same trade org-test-db.ts makes with
// USERS_STUB.
//
// Not stubbed away: the migration's own DDL. If 0036 is wrong, these fail.

const MIGRATION = "drizzle/0036_content_plan_item.sql";

// FK targets only. `post` is deliberately minimal here — the publisher's own
// suite (lib/posts-admin/scheduled-publisher.test.ts) owns the fuller stub.
const FK_TARGET_STUBS = `
  CREATE TABLE IF NOT EXISTS "category" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug" text NOT NULL UNIQUE,
    "name" text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS "post" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug" text NOT NULL UNIQUE,
    "title" text NOT NULL
  );
`;

// Split on the drizzle statement delimiter, exactly as scripts/db-apply.mjs
// does in production, so DO-blocks with internal semicolons stay intact.
async function runMigration(client: PGlite, sqlText: string) {
  const statements = sqlText
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.replace(/--.*$/gm, "").trim().match(/^$/));
  for (const statement of statements) {
    await client.query(statement);
  }
}

export interface QueueTestDb {
  db: DB;
  client: PGlite;
  createItem: (over?: {
    dayNumber?: number;
    title?: string;
    status?: string;
  }) => Promise<string>;
  setStatus: (id: string, status: string) => Promise<void>;
  setRunning: (
    id: string,
    lockedBy: string,
    lockedUntil: Date,
    attempts: number,
  ) => Promise<void>;
  get: (id: string) => Promise<Record<string, unknown>>;
  /** Re-run the migration, proving it is idempotent. */
  applyMigration: () => Promise<void>;
  close: () => Promise<void>;
}

export async function makeQueueTestDb(): Promise<QueueTestDb> {
  const client = new PGlite();
  const migrationSql = readFileSync(join(process.cwd(), MIGRATION), "utf8");

  // exec(), not query(): PGlite's query() runs a single statement, and this
  // stub is a two-statement script.
  await client.exec(FK_TARGET_STUBS);
  const apply = () => runMigration(client, migrationSql);
  await apply();

  const db = drizzle(client, { schema }) as unknown as DB;
  let n = 0;

  return {
    db,
    client,
    applyMigration: apply,
    createItem: async (over = {}) => {
      n += 1;
      const res = await client.query<{ id: string }>(
        `INSERT INTO "content_plan_item"
           ("batch_id","day_number","title","format","topic","audience","action","status")
         VALUES (gen_random_uuid(),$1,$2,'short','t','a','act',$3) RETURNING id`,
        [over.dayNumber ?? n, over.title ?? `Item ${n}`, over.status ?? "pending"],
      );
      return res.rows[0].id;
    },
    setStatus: async (id, status) => {
      await client.query(`UPDATE "content_plan_item" SET status = $1 WHERE id = $2`, [
        status,
        id,
      ]);
    },
    setRunning: async (id, lockedBy, lockedUntil, attempts) => {
      await client.query(
        `UPDATE "content_plan_item"
            SET status='running', locked_by=$1, locked_until=$2, attempts=$3
          WHERE id=$4`,
        [lockedBy, lockedUntil, attempts, id],
      );
    },
    get: async (id) => {
      const res = await client.query<Record<string, unknown>>(
        `SELECT * FROM "content_plan_item" WHERE id = $1`,
        [id],
      );
      return res.rows[0];
    },
    close: async () => {
      await client.close();
    },
  };
}
