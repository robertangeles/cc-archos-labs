// Real-Postgres proof that updateIntegrationSecret's `.for("update")` serialises
// overlapping saves. pglite is single-connection and CI has no Postgres, so this
// file is skipped unless REAL_PG_URL is set, and refuses any host but this machine.
//
// Run (DEV Postgres only):
//   ( set -a; . ./.env.local; set +a; REAL_PG_URL="$DATABASE_URL" pnpm vitest run tests/real-pg/integration-lock.real-pg.test.ts )
//
// It works in a throwaway schema (copies of site_setting and
// integration_secret_audit, dropped afterwards), so no DEV row is touched.
//
// Deterministic, no sleeps: connection A holds FOR UPDATE on the blob row, save B
// starts, and we poll pg_stat_activity until B is blocked by A's pid. A then
// writes a different field and commits. With the lock, B re-reads the new blob
// and keeps A's field. Without it B reads the stale blob, blocks only at its
// upsert, then overwrites A's field, so the final assertion fails.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../lib/db/schema";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../lib/db", () => ({ getDb: () => holder.db }));

import { updateIntegrationSecret } from "../../lib/integration-config";

const REAL_PG_URL = process.env.REAL_PG_URL;
const BLOB_KEY = "integration_secrets";

describe.skipIf(!REAL_PG_URL)("updateIntegrationSecret row lock (real Postgres)", () => {
  const schemaName = `lock_proof_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const appName = `lock-proof-${schemaName}`;
  let admin: postgres.Sql;
  let holderConn: postgres.Sql;
  let observer: postgres.Sql;
  let appClient: postgres.Sql;

  beforeAll(async () => {
    const host = new URL(REAL_PG_URL!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(`REAL_PG_URL host must be 127.0.0.1 or localhost, got "${host}". DEV only.`);
    }
    process.env.BOOKING_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    admin = postgres(REAL_PG_URL!, { max: 1, onnotice: () => undefined });
    holderConn = postgres(REAL_PG_URL!, { max: 1 });
    observer = postgres(REAL_PG_URL!, { max: 1 });
    await admin.unsafe(`CREATE SCHEMA ${schemaName}`);
    for (const table of ["site_setting", "integration_secret_audit"]) {
      await admin.unsafe(`CREATE TABLE ${schemaName}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await admin.unsafe(
      `INSERT INTO ${schemaName}.site_setting (key, value) VALUES ('${BLOB_KEY}', '{"contactRecipientEmail":"seed@example.com"}')`,
    );

    // The app's pool: what getDb() returns while the mock is active.
    appClient = postgres(REAL_PG_URL!, {
      max: 4,
      connection: { search_path: schemaName, application_name: appName },
    });
    holder.db = drizzle(appClient, { schema });
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

  it("makes an overlapping save wait, then merge onto the committed blob instead of overwriting it", async () => {
    const [{ pid }] = await holderConn<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;

    await holderConn.unsafe("BEGIN");
    let committed = false;
    let saveB: Promise<void> | undefined;
    try {
      await holderConn.unsafe(
        `SELECT 1 FROM ${schemaName}.site_setting WHERE key = '${BLOB_KEY}' FOR UPDATE`,
      );

      let saveBSettled = false;
      saveB = updateIntegrationSecret("xArticlesMode", "draft").then(() => {
        saveBSettled = true;
      });

      expect(await waitUntilBlockedBy(pid), "save B should be waiting on A's row lock").toBe(true);
      expect(saveBSettled, "save B must not finish before A commits").toBe(false);

      await holderConn.unsafe(
        `UPDATE ${schemaName}.site_setting SET value = value || '{"xApiKey":"keep-me"}'::jsonb WHERE key = '${BLOB_KEY}'`,
      );
      await holderConn.unsafe("COMMIT");
      committed = true;

      await saveB;
      expect(saveBSettled).toBe(true);
    } finally {
      if (!committed) await holderConn.unsafe("ROLLBACK").catch(() => undefined);
      await saveB?.catch(() => undefined);
    }

    const [row] = await admin.unsafe(
      `SELECT value FROM ${schemaName}.site_setting WHERE key = '${BLOB_KEY}'`,
    );
    // A lost update would drop xApiKey (B wrote back the blob it read before A's commit).
    expect(row.value).toMatchObject({
      contactRecipientEmail: "seed@example.com",
      xApiKey: "keep-me",
      xArticlesMode: "draft",
    });
  }, 20_000);
});
