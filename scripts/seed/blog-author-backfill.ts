// Idempotent author-row backfill for the Translation Layer migration.
//
// The migration's `ensureAuthor` find-or-creates by slug only — it never
// overwrites name/photo/bio on subsequent runs. The migrated row lands
// with WP's `display_name` (which was "Sparq") and nulls for everything
// else. This script writes the public byline values that should appear
// in the Written By card on every post page:
//
//   name           = "Rob Angeles"
//   photo_url      = "/images/ran-square.png"  (square crops cleanly to circle)
//   linkedin_url   = the LinkedIn URL
//   bio_md         = one-paragraph practitioner bio
//
// Idempotent: re-running on a row that already matches is a no-op
// (UPDATE returns 1 row affected but the values don't change). Safe to
// run as many times as needed.
//
// Run via:
//   pnpm seed:blog-author

import { env, exit, stderr } from "node:process";
import postgres from "postgres";

const AUTHOR_SLUG = "robangeles";

const AUTHOR_FIELDS = {
  name: "Rob Angeles",
  photoUrl: "/images/ran-square.png",
  linkedinUrl: "https://www.linkedin.com/in/robangeles22",
  bioMd:
    "Principal Consultant at Archos Labs. 25 years across financial " +
    "services, healthcare, and government — one person who runs the " +
    "assessment, the architecture, and the delivery.",
} as const;

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    stderr.write("ERROR: DATABASE_URL is not set in .env.local\n");
    exit(1);
  }

  const sql = postgres(env.DATABASE_URL, { ssl: "require", max: 1 });
  try {
    const before = await sql<
      Array<{ id: string; name: string; photo_url: string | null }>
    >`
      SELECT id, name, photo_url FROM author WHERE slug = ${AUTHOR_SLUG}
    `;
    if (before.length === 0) {
      stderr.write(
        `ERROR: No author row with slug '${AUTHOR_SLUG}'. Run the migration ` +
          `first so ensureAuthor creates the row.\n`,
      );
      exit(1);
    }
    stderr.write(
      `Before: name='${before[0].name}', photo_url='${before[0].photo_url ?? "(null)"}'\n`,
    );

    const result = await sql`
      UPDATE author
      SET name = ${AUTHOR_FIELDS.name},
          photo_url = ${AUTHOR_FIELDS.photoUrl},
          linkedin_url = ${AUTHOR_FIELDS.linkedinUrl},
          bio_md = ${AUTHOR_FIELDS.bioMd},
          updated_at = NOW()
      WHERE slug = ${AUTHOR_SLUG}
    `;
    stderr.write(`Rows updated: ${result.count}\n`);

    const after = await sql<
      Array<{ name: string; photo_url: string | null }>
    >`
      SELECT name, photo_url FROM author WHERE slug = ${AUTHOR_SLUG}
    `;
    stderr.write(
      `After:  name='${after[0].name}', photo_url='${after[0].photo_url ?? "(null)"}'\n`,
    );
    stderr.write(`Done.\n`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  exit(1);
});
