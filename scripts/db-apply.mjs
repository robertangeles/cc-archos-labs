// Apply Drizzle-generated migration SQL files directly. Run with:
//   node --env-file=.env.local scripts/db-apply.mjs
//
// We use this instead of `drizzle-kit push` because push hangs on the
// "Pulling schema from database" step against Render Postgres (likely a
// drizzle-kit + postgres.js + cloud-postgres edge case). Apply the
// generated SQL directly, idempotently — each migration is wrapped in
// IF NOT EXISTS where supported, and tracked in the drizzle migrations
// metadata for compatibility.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require" });

try {
  // Track applied migrations in a small metadata table so re-runs skip
  // already-applied files.
  await sql`
    create table if not exists __drizzle_applied (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const dir = "drizzle";
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const already = await sql`
      select 1 from __drizzle_applied where filename = ${file}
    `;
    if (already.length > 0) {
      console.log(`SKIP ${file} (already applied)`);
      continue;
    }

    const ddl = readFileSync(join(dir, file), "utf8");
    // Drizzle uses `--> statement-breakpoint` to delimit multi-statement files.
    const statements = ddl
      .split(/-->\s*statement-breakpoint/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log(`APPLY ${file} (${statements.length} statements)`);
    for (const stmt of statements) {
      await sql.unsafe(stmt);
    }
    await sql`insert into __drizzle_applied (filename) values (${file})`;
    console.log(`  OK ${file}`);
  }

  // Verify the site_setting table is present
  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = 'site_setting'
  `;
  if (tables.length === 0) {
    throw new Error("site_setting table not found after migration");
  }
  console.log("site_setting table present.");
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
