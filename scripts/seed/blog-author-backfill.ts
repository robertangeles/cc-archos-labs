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
//   linkedin_url   = the prod LinkedIn URL
//   bio_md         = one-paragraph practitioner bio
//
// Idempotent: re-running on a row that's already correct is a no-op
// (UPDATE returns 0 rows changed). Safe to run as many times as needed.
//
// Run via:
//   pnpm seed:blog-author                                # dev DB
//   pnpm seed:blog-author --prod --confirm-prod          # prod DB (requires
//                                                        # PROD_DATABASE_URL
//                                                        # in shell env)

import { argv, env, exit, stderr, stdout } from "node:process";
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

interface Args {
  prod: boolean;
  confirmProd: boolean;
}

function parseArgs(): Args {
  const args = argv.slice(2);
  const out: Args = { prod: false, confirmProd: false };
  for (const a of args) {
    if (a === "--") continue;
    if (a === "--prod") out.prod = true;
    else if (a === "--confirm-prod") out.confirmProd = true;
    else if (a === "-h" || a === "--help") {
      printUsage();
      exit(0);
    } else {
      die(`Unknown flag: ${a}`);
    }
  }
  return out;
}

function printUsage(): void {
  stdout.write(`
scripts/seed/blog-author-backfill — idempotent author UPDATE.

Usage:
  pnpm seed:blog-author                              # dev DB (reads DATABASE_URL)
  pnpm seed:blog-author --prod --confirm-prod        # prod DB (reads PROD_DATABASE_URL)

Required env:
  DATABASE_URL        Archos Labs Postgres (dev)         [non-prod runs]
  PROD_DATABASE_URL   Archos Labs Postgres (prod)        [--prod runs only;
                                                          MUST be set in shell,
                                                          NOT .env.local]
`);
}

function die(msg: string): never {
  stderr.write(`ERROR: ${msg}\n`);
  exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Resolve target connection string with the same safety gate as
  // migrate-wp: --prod must be paired with --confirm-prod, PROD_DATABASE_URL
  // must be set, and it must differ from DATABASE_URL.
  let connectionString: string;
  let target: string;
  if (args.prod) {
    if (!args.confirmProd) {
      die("--prod requires --confirm-prod as an explicit safety gate.");
    }
    if (!env.PROD_DATABASE_URL) {
      die(
        "--prod is set but PROD_DATABASE_URL is empty. Export it in your " +
          "shell before running (do NOT put prod creds in .env.local).",
      );
    }
    if (env.DATABASE_URL && env.PROD_DATABASE_URL === env.DATABASE_URL) {
      die(
        "PROD_DATABASE_URL and DATABASE_URL resolve to the same connection " +
          "string. That defeats the safety gate.",
      );
    }
    connectionString = env.PROD_DATABASE_URL;
    target = extractHost(connectionString);
    stderr.write(
      `\n` +
        `============================================================\n` +
        `  TARGET: PRODUCTION DB (${target})\n` +
        `  Both --prod and --confirm-prod were passed. Proceeding.\n` +
        `============================================================\n\n`,
    );
  } else {
    if (!env.DATABASE_URL) {
      die("DATABASE_URL is not set. (Did you mean to pass --prod?)");
    }
    connectionString = env.DATABASE_URL;
    target = extractHost(connectionString);
    stderr.write(`Target: dev (${target})\n`);
  }

  const sql = postgres(connectionString, { ssl: "require", max: 1 });
  try {
    const before = await sql<
      Array<{ id: string; name: string; photo_url: string | null }>
    >`
      SELECT id, name, photo_url FROM author WHERE slug = ${AUTHOR_SLUG}
    `;
    if (before.length === 0) {
      die(
        `No author row with slug '${AUTHOR_SLUG}' on this DB. Run the ` +
          `migration first so ensureAuthor creates the row.`,
      );
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

function extractHost(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    return u.host || "(unknown host)";
  } catch {
    return "(unparseable)";
  }
}

main().catch((err) => {
  stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  exit(1);
});
