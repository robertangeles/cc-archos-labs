#!/usr/bin/env node
// One-shot: update the org-level site_setting.description to the May 2026
// SMB / fractional-data positioning. Idempotent — re-running with the same
// target text is a no-op.
//
// Usage:
//   node --env-file-if-exists=.env.local scripts/update-site-description.mjs --dry-run
//   node --env-file-if-exists=.env.local scripts/update-site-description.mjs --apply
//
// The script prints the BEFORE row, then either reports what it would do
// (--dry-run, default) or applies the JSONB merge under one transaction.

import postgres from "postgres";

const NEW_DESCRIPTION =
  "No data team? Rob Angeles works with startup founders and SMBs as their fractional data person. Fixed-fee. No retainer. Melbourne, Australia.";

const apply = process.argv.includes("--apply");
const dryRun = !apply;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Aborting.");
  process.exit(2);
}

const sql = postgres(url, { max: 1, ssl: "require" });

try {
  const before = await sql`
    select value
      from site_setting
     where key = 'site'
     limit 1
  `;

  if (before.length === 0) {
    console.error("No site_setting row with key='site'. Aborting.");
    process.exit(3);
  }

  const current = before[0].value;
  console.log("BEFORE description:");
  console.log(`  ${current.description ?? "(empty)"}`);
  console.log("");
  console.log("TARGET description:");
  console.log(`  ${NEW_DESCRIPTION}`);
  console.log("");

  if (current.description === NEW_DESCRIPTION) {
    console.log("Already up to date. No-op.");
    process.exit(0);
  }

  if (dryRun) {
    console.log("DRY RUN — pass --apply to write.");
    process.exit(0);
  }

  await sql`
    update site_setting
       set value = jsonb_set(value, '{description}', to_jsonb(${NEW_DESCRIPTION}::text), true),
           updated_at = now()
     where key = 'site'
  `;

  const after = await sql`
    select value->>'description' as description
      from site_setting
     where key = 'site'
     limit 1
  `;

  console.log("AFTER description:");
  console.log(`  ${after[0].description}`);
  console.log("");
  console.log("Done.");
} finally {
  await sql.end({ timeout: 5 });
}
