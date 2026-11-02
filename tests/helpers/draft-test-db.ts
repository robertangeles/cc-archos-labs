import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../lib/db/schema";
import type { DB } from "../../lib/db";

// Ephemeral-Postgres harness for the news draft pipeline, against a REAL Postgres
// engine (pglite, in-process, no Docker).
//
// Like radar-test-db.ts it replays the real migration SQL, so the tests exercise
// the same CHECK, UNIQUE and FK constraints production has. 0043 references the
// post table, whose real definition carries a pgvector column pglite does not
// load, so a stub with only the id stands in for it (the same reason
// post-test-db.ts stubs it).
//
// Caveat inherited from pglite: single-connection, so FOR UPDATE SKIP LOCKED
// concurrency is not exercised. Lease races are proven sequentially instead.

const STUB_POST = `CREATE TABLE IF NOT EXISTS "post" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid())`;

// The settings table the flag and the config read. Same columns as production.
const SITE_SETTING = `
  CREATE TABLE IF NOT EXISTS "site_setting" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "key" text NOT NULL UNIQUE,
    "value" jsonb NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
  )`;

export interface DraftTestDb {
  db: DB;
  client: PGlite;
  /** Insert a scored feed item, returning its id. */
  addCandidate: (over?: { title?: string; summary?: string; url?: string }) => Promise<string>;
  /** Append a label row, as the admin API does. */
  label: (candidateId: string, decision: "keep" | "skip" | "clear") => Promise<void>;
  /** A stub post row, for tests that need a real post id. */
  addPost: () => Promise<string>;
  /** Upsert a site_setting row. */
  setSetting: (key: string, value: unknown) => Promise<void>;
  close: () => Promise<void>;
}

async function replay(client: PGlite, file: string) {
  const statements = readFileSync(join(process.cwd(), "drizzle", file), "utf8")
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) await client.exec(stmt);
}

export async function makeDraftTestDb(): Promise<DraftTestDb> {
  const client = new PGlite();
  await client.exec(STUB_POST);
  await client.exec(SITE_SETTING);
  await replay(client, "0042_news_radar.sql");
  await replay(client, "0043_news_draft.sql");

  let n = 0;
  return {
    db: drizzle(client, { schema }) as unknown as DB,
    client,
    addCandidate: async (over = {}) => {
      n += 1;
      const res = await client.query<{ id: string }>(
        `INSERT INTO "news_candidate" ("source_url","title","summary","published_at","status")
         VALUES ($1,$2,$3,now(),'scored') RETURNING id`,
        [over.url ?? `https://huggingnews.com/ai/story-${n}`, over.title ?? `Story ${n}`, over.summary ?? `Summary ${n}`],
      );
      return res.rows[0].id;
    },
    label: async (candidateId, decision) => {
      await client.query(`INSERT INTO "news_candidate_label" ("candidate_id","decision") VALUES ($1,$2)`, [candidateId, decision]);
    },
    setSetting: async (key, value) => {
      await client.query(
        `INSERT INTO "site_setting" ("key","value") VALUES ($1,$2::jsonb)
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`,
        [key, JSON.stringify(value)],
      );
    },
    addPost: async () => (await client.query<{ id: string }>(`INSERT INTO "post" DEFAULT VALUES RETURNING id`)).rows[0].id,
    close: async () => {
      await client.close();
    },
  };
}
