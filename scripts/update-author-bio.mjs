// scripts/update-author-bio.mjs
//
// One-off content update — replace the bio_md of a single author row.
// Lives in scripts/ because [[deployment-architecture]] is single-env
// (DATABASE_URL points at prod from both .env.local and Render) and
// the project deliberately defers a multi-author admin UI per
// [[2026-05-20-posts-admin-phase-d-ui]] "Out of scope".
//
// Pattern matches scripts/backfill-og-image-alt.mjs: dry-run by
// default, --apply flag to actually write, idempotent on re-run.
//
// Run:
//   node --env-file=.env.local scripts/update-author-bio.mjs
//     # dry run — prints current vs new bio for the named author
//
//   node --env-file=.env.local scripts/update-author-bio.mjs --apply
//     # writes the new bio (single UPDATE)
//
// To change the bio text, edit NEW_BIO_MD below. To target a different
// author, change AUTHOR_SLUG. The script intentionally hard-codes both
// so the diff in git review shows exactly what landed in prod.

import postgres from "postgres";

const AUTHOR_SLUG = "robangeles";

const NEW_BIO_MD = `Most consulting engagements split the thinking from the doing. Rob doesn't. Principal Consultant at Archos Labs, he owns the full stack — assessment, architecture, delivery — across retail, financial services, healthcare, and government.`;

const APPLY = process.argv.includes("--apply");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL not set. Run with: node --env-file=.env.local scripts/update-author-bio.mjs",
  );
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

try {
  // 1. Look up the target row by slug. Fail loudly if 0 or >1 rows.
  const rows = await sql`
    SELECT id, slug, name, bio_md, length(bio_md) as current_len, updated_at
    FROM author
    WHERE slug = ${AUTHOR_SLUG}
  `;

  if (rows.length === 0) {
    console.error(`No author row with slug='${AUTHOR_SLUG}'. Aborting.`);
    console.error(
      "Available authors:",
      (await sql`SELECT slug FROM author ORDER BY slug`).map((r) => r.slug),
    );
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(
      `${rows.length} rows match slug='${AUTHOR_SLUG}'. Aborting (data integrity issue).`,
    );
    process.exit(1);
  }

  const before = rows[0];

  // 2. Print the diff.
  console.log("---");
  console.log(`Author: ${before.name} (id=${before.id}, slug=${before.slug})`);
  console.log(`Bio updated_at: ${before.updated_at}`);
  console.log("---");
  console.log("CURRENT BIO:");
  console.log(`  ${before.bio_md ?? "(null)"}`);
  console.log("---");
  console.log("NEW BIO:");
  console.log(`  ${NEW_BIO_MD}`);
  console.log("---");
  console.log(
    `Length: ${before.current_len ?? 0} chars → ${NEW_BIO_MD.length} chars`,
  );

  if (before.bio_md === NEW_BIO_MD) {
    console.log("\nNo-op: bio already matches NEW_BIO_MD. Exiting.");
    process.exit(0);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no rows updated. Re-run with --apply to write.");
    process.exit(0);
  }

  // 3. Apply. Single UPDATE, parameterised. No transaction needed for
  //    a single-row update — Postgres treats single statements atomic.
  const result = await sql`
    UPDATE author
    SET bio_md = ${NEW_BIO_MD}
    WHERE slug = ${AUTHOR_SLUG}
    RETURNING id, slug, name, length(bio_md) as new_len, updated_at
  `;

  if (result.length !== 1) {
    console.error(`Unexpected: UPDATE affected ${result.length} rows.`);
    process.exit(1);
  }

  console.log("\nUPDATED:");
  console.log(`  id: ${result[0].id}`);
  console.log(`  new bio length: ${result[0].new_len} chars`);
  console.log(`  updated_at: ${result[0].updated_at}`);
  console.log("\nDone.");
} catch (err) {
  console.error("ERROR:", err);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
