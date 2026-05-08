// One-off DB connection test. Run with:
//   node --env-file=.env.local scripts/test-db.mjs
// Verifies that DATABASE_URL works against Render Postgres before
// drizzle-kit operations rely on it.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

console.log("Connecting to:", url.replace(/:[^@]+@/, ":****@"));

const sql = postgres(url, { max: 1, ssl: "require" });

try {
  const result = await sql`select version()`;
  console.log("OK — server version:", result[0].version);
  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;
  console.log("Tables in public schema:", tables.map((t) => t.table_name));
} catch (err) {
  console.error("FAILED:", err.message);
  console.error("Code:", err.code);
  process.exit(1);
} finally {
  await sql.end();
}
