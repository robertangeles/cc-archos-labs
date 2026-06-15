import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "../../lib/db/schema";
import type { DB } from "../../lib/db";

// ============================================================================
// Ephemeral-Postgres test harness (Eng-2 / D2) — proves cross-org isolation
// and migration idempotency against a REAL Postgres engine (pglite, in-process,
// no Docker). Mocks can't prove isolation; this can.
//
// Scope (D4 #13): validates where-clause scoping logic + backfill correctness +
// migration re-runnability. Does NOT validate concurrency/MVCC (pglite is
// single-connection) — that is out of scope by design.
// ============================================================================

// Minimal stand-in for the real `users` table so migration 0025's FKs to
// users(id) resolve. We only need the columns the org tables reference + the
// columns tests insert. The full users table is exercised in app integration.
const USERS_STUB = `
  CREATE TABLE IF NOT EXISTS "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" varchar(255) NOT NULL,
    "display_name" varchar(200),
    "role" varchar(50) NOT NULL DEFAULT 'member',
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
  )
`;

// Org-feature migrations, applied in order. 0025 = org/clients/projects/kanban
// tables; 0026 = contract_attachment. Add later org migrations here.
const MIGRATION_FILES = [
  "drizzle/0025_natural_war_machine.sql",
  "drizzle/0026_light_mysterio.sql",
];

// Run a drizzle-generated SQL file one statement at a time, exactly as
// scripts/db-apply.mjs does in production (split on the statement-breakpoint
// delimiter so DO-blocks with internal semicolons stay intact).
async function runMigration(client: PGlite, migrationSql: string) {
  const statements = migrationSql
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.replace(/--.*$/gm, "").trim().match(/^$/));
  for (const statement of statements) {
    await client.query(statement);
  }
}

export interface OrgTestDb {
  /** Drizzle client bound to the org schema (typed as the app's DB). */
  db: DB;
  /** Raw pglite client for setup/teardown. */
  client: PGlite;
  /** Re-run the migration SQL (for idempotency assertions). */
  applyMigration: () => Promise<void>;
  /** Insert a stub user, returning its id. */
  createUser: (email: string, name?: string) => Promise<string>;
  /** Close the in-memory database. */
  close: () => Promise<void>;
}

export async function makeOrgTestDb(): Promise<OrgTestDb> {
  const client = new PGlite();
  const migrationSqls = MIGRATION_FILES.map((f) =>
    readFileSync(join(process.cwd(), f), "utf8"),
  );

  const applyAll = async () => {
    for (const migrationSql of migrationSqls) {
      await runMigration(client, migrationSql);
    }
  };

  await client.query(USERS_STUB);
  await applyAll();

  // pglite's drizzle client and postgres-js's share the query API; the cast
  // keeps service functions (typed against the app DB) usable in tests.
  const db = drizzle(client, { schema }) as unknown as DB;

  return {
    db,
    client,
    applyMigration: applyAll,
    createUser: async (email: string, name = "Test User") => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO "users" ("email","display_name") VALUES ($1,$2) RETURNING id`,
        [email, name],
      );
      return res.rows[0].id;
    },
    close: async () => {
      await client.close();
    },
  };
}

export { sql };
