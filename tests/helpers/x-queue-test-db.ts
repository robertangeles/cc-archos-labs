import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../lib/db/schema";
import type { DB } from "../../lib/db";

// Ephemeral-Postgres harness for the X Article queue, against a REAL Postgres
// engine (pglite, in-process, no Docker).
//
// Like draft-test-db.ts it replays the real migration SQL, so the tests exercise
// the same CHECK, UNIQUE and FK constraints production has. 0046 references the
// post table, whose real definition carries a pgvector column pglite does not
// load, so a stub with only the columns the queue reads stands in for it: the
// ones PUBLIC_LISTED_FILTER filters on, plus published_at for the sweep window.
//
// Caveat inherited from pglite: single-connection, so FOR UPDATE SKIP LOCKED
// concurrency is not exercised here. Lease races are proven sequentially; the
// concurrent proofs live in tests/real-pg/x-article-queue.real-pg.test.ts.

const POST_STUB = `
  CREATE TABLE IF NOT EXISTS "post" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "status" text NOT NULL DEFAULT 'draft',
    "visibility" text NOT NULL DEFAULT 'listed',
    "archived_at" timestamp with time zone,
    "published_at" timestamp with time zone
  )`;

export interface XQueueTestDb {
  db: DB;
  client: PGlite;
  /** Insert a post, returning its id. Defaults make a public, listed post published at `publishedAt`. */
  addPost: (over?: {
    status?: string;
    visibility?: string;
    archivedAt?: Date | null;
    publishedAt?: Date | null;
  }) => Promise<string>;
  /** Back to a freshly migrated, empty database (one boot per file, as in draft-test-db.ts). */
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function makeXQueueTestDb(publishedAt: Date): Promise<XQueueTestDb> {
  const client = new PGlite();
  await client.exec(POST_STUB);
  const statements = readFileSync(join(process.cwd(), "drizzle", "0046_x_article_publication.sql"), "utf8")
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) await client.exec(stmt);

  return {
    db: drizzle(client, { schema }) as unknown as DB,
    client,
    addPost: async (over = {}) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO "post" ("status","visibility","archived_at","published_at") VALUES ($1,$2,$3,$4) RETURNING id`,
          [
            over.status ?? "published",
            over.visibility ?? "listed",
            over.archivedAt ?? null,
            over.publishedAt === undefined ? publishedAt : over.publishedAt,
          ],
        )
      ).rows[0].id,
    reset: async () => {
      await client.exec(`TRUNCATE x_article_publication, post RESTART IDENTITY CASCADE`);
    },
    close: async () => {
      await client.close();
    },
  };
}
