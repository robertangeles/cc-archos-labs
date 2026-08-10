// Attach the house fallback illustration to published agent posts that have
// no featured image at all.
//
// WHY THESE POSTS EXIST
//
// `finish()` in lib/blog-agent/run.ts used to call createPost with
// needsReview: false BEFORE attachIllustration ran. A run that died in that
// window left a post that was already publishable with a blank featured slot,
// and because the queue item stayed `running`, the sweeper reclaimed it and the
// retry wrote a SECOND post that took the post_id pointer — orphaning the
// first. On PROD the correlation was exact: 42 of 42 posts WITH a
// content_plan_item had an image, 2 of 2 orphans had none.
//
// The ordering bug is fixed (the post is now held at needs_review until the
// illustration attaches), so this script is a one-off for the rows that
// already shipped. It is safe to re-run: it only touches rows where every
// image column is still NULL.
//
// This mirrors attachFallbackImageToPost (lib/posts-admin/attach-image.ts)
// rather than importing it — that module is `server-only` and pulls the Next
// runtime in, which a plain node script cannot load.
//
// Run:
//   node --env-file=.env.local scripts/backfill-orphan-post-image.mjs
//     # dry run — lists the posts that would be updated
//
//   node --env-file=.env.local scripts/backfill-orphan-post-image.mjs --apply
//
//   DATABASE_URL="<prod>" node scripts/backfill-orphan-post-image.mjs --apply
//     # target PROD explicitly

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env, exit, argv } from "node:process";
import postgres from "postgres";
import { imageSize } from "image-size";

const APPLY = argv.includes("--apply");

const FALLBACK_PUBLIC_PATH = "/images/blog-fallback.webp";
const FALLBACK_DISK_PATH = join("public", "images", "blog-fallback.webp");
const FALLBACK_ALT = "Archos Labs editorial illustration";

const SITE_URL = (env.NEXT_PUBLIC_SITE_URL ?? "https://archoslabs.xyz").replace(/\/+$/, "");

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL not set. Run with: node --env-file=.env.local <script>");
  exit(1);
}

const sql = postgres(env.DATABASE_URL, {
  // Local dev Postgres has no TLS; Render requires it.
  ssl: env.DATABASE_URL.includes("127.0.0.1") || env.DATABASE_URL.includes("localhost")
    ? false
    : "require",
  max: 1,
});

try {
  // Published, agent-written, and never illustrated by any path. Deliberately
  // NOT keyed on the two known slugs — if the ordering bug produced others
  // before the fix shipped, they belong here too.
  const orphans = await sql`
    SELECT id, slug, title
    FROM post
    WHERE status = 'published'
      AND is_agent_generated = true
      AND og_image_path IS NULL
      AND og_image_deleted_at IS NULL
    ORDER BY published_at
  `;

  if (orphans.length === 0) {
    console.log("No published agent posts are missing an image. Nothing to do.");
    exit(0);
  }

  console.log(`Found ${orphans.length} published post(s) with no featured image:\n`);
  for (const p of orphans) console.log(`  ${p.slug}\n    ${p.title}`);

  if (!APPLY) {
    console.log("\nDRY RUN — no rows updated. Re-run with --apply to write.");
    exit(0);
  }

  const bytes = await readFile(FALLBACK_DISK_PATH);
  const dim = imageSize(bytes);
  const now = new Date();
  const publicUrl = `${SITE_URL}${FALLBACK_PUBLIC_PATH}`;

  // og_image_path is stored absolute because OG meta, RSS enclosures and
  // JSON-LD all need a fully-qualified URL. That makes it environment-specific,
  // and the two env vars come from different places: DATABASE_URL is usually
  // set on the command line to target PROD, while NEXT_PUBLIC_SITE_URL comes
  // from --env-file=.env.local and still says localhost. Running
  // `DATABASE_URL="<prod>" node --env-file=.env.local ...` would therefore
  // write localhost image URLs into PROD, breaking every social preview on
  // every post it touched. Refuse rather than let the two disagree.
  const dbIsLocal = /127\.0\.0\.1|localhost/.test(env.DATABASE_URL);
  const urlIsLocal = /127\.0\.0\.1|localhost/.test(SITE_URL);
  if (dbIsLocal !== urlIsLocal) {
    console.error(
      `REFUSING TO WRITE: the database and the site URL are in different ` +
        `environments.\n  database: ${dbIsLocal ? "local" : "remote"}\n` +
        `  site URL: ${SITE_URL}\n` +
        `Set NEXT_PUBLIC_SITE_URL to match the database you are targeting ` +
        `(or drop --env-file when targeting PROD).`,
    );
    exit(1);
  }

  const ids = orphans.map((p) => p.id);
  const updated = await sql`
    UPDATE post SET
      og_image_path         = ${publicUrl},
      og_image_generated_at = ${now},
      og_image_alt          = ${FALLBACK_ALT},
      og_image_width        = ${dim.width ?? null},
      og_image_height       = ${dim.height ?? null},
      og_image_filename     = 'blog-fallback.webp',
      og_image_mime_type    = 'image/webp',
      og_image_size_kb      = ${Math.round(bytes.byteLength / 1024)},
      og_image_uploaded_at  = ${now},
      og_image_deleted_at   = NULL,
      updated_at            = ${now}
    WHERE id = ANY(${ids})
    RETURNING slug
  `;

  console.log(`\nUPDATED ${updated.length} post(s):`);
  for (const r of updated) console.log(`  ${r.slug} → ${publicUrl}`);
  console.log("\nDone.");
} catch (err) {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  exit(1);
} finally {
  await sql.end();
}
