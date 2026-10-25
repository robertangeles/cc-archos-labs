import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../lib/db/schema";
import type { DB } from "../../lib/db";

// Ephemeral-Postgres harness for the news radar, against a REAL Postgres engine
// (pglite, in-process, no Docker).
//
// Unlike post-test-db.ts this replays the real migration SQL instead of a stub:
// the radar tables carry no vector column and reference no other table, so
// drizzle/0042_news_radar.sql applies as is, and the tests exercise the same
// CHECK, UNIQUE and FK constraints production has. The file is split on the
// same `--> statement-breakpoint` marker scripts/db-apply.mjs uses.
//
// Caveat inherited from pglite: single-connection, so this does NOT exercise
// FOR UPDATE SKIP LOCKED concurrency. The stale-claim race is proven
// sequentially instead (A claims, the claim expires, B reclaims, A's commit
// matches zero rows), which is what the conditional write guarantees.

const MIGRATION = join(process.cwd(), "drizzle", "0042_news_radar.sql");

export interface RadarTestDb {
  db: DB;
  client: PGlite;
  close: () => Promise<void>;
}

export async function makeRadarTestDb(): Promise<RadarTestDb> {
  const client = new PGlite();
  const statements = readFileSync(MIGRATION, "utf8")
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await client.exec(stmt);
  }

  return {
    db: drizzle(client, { schema }) as unknown as DB,
    client,
    close: async () => {
      await client.close();
    },
  };
}
