// scripts/backfill-og-image-alt.mjs
//
// Backfill `post.og_image_alt` for the 253 migrated posts.
//
// Source priority per row:
//   1. WP `_wp_attachment_image_alt` for the post's `_thumbnail_id`
//      attachment, if present + non-empty (after HTML strip + trim).
//   2. Fall back to the post's title (always present, NOT NULL on post.title).
//
// Cleanup applied to WP alt text before write:
//   - Strip any HTML tags
//   - Trim whitespace
//   - Truncate to 125 characters
//
// Run:
//   node --env-file=.env.local scripts/backfill-og-image-alt.mjs            # dry run (default, safe)
//   node --env-file=.env.local scripts/backfill-og-image-alt.mjs --apply    # actually write
//
// Dry run prints the first 10 rows in this format:
//   slug | source | alt_text_to_write
// where `source` is 'wp' or 'title_fallback'.
//
// Apply mode writes one UPDATE per row, then prints a summary:
//   total updated / used WP / used title fallback / skipped / failed.
//
// Re-runnable: writes are idempotent (UPDATE to the same value is a
// no-op). Safe to re-run as needed.

import mysql from "mysql2/promise";
import postgres from "postgres";

const ALT_MAX_LEN = 125;
const apply = process.argv.includes("--apply");

const wpUrl = process.env.WP_DATABASE_URL;
const pgUrl = process.env.DATABASE_URL;
const wpPrefix = process.env.WP_TABLE_PREFIX ?? "uhiz_";

if (!wpUrl || !pgUrl) {
  console.error("FATAL  WP_DATABASE_URL or DATABASE_URL not set in .env.local");
  process.exit(1);
}

// --- Pull alt text from WP for every published post ----------------------

let wpConn;
try {
  const u = new URL(wpUrl);
  wpConn = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    connectTimeout: 10_000,
  });
} catch (err) {
  console.error("FATAL  WP connect:", err.message);
  process.exit(1);
}

const [wpRows] = await wpConn.query(
  `SELECT
     p.ID AS post_id,
     thumb.meta_value AS attachment_id,
     alt.meta_value AS alt_text
   FROM ${wpPrefix}posts p
   LEFT JOIN ${wpPrefix}postmeta thumb
     ON thumb.post_id = p.ID
    AND thumb.meta_key = '_thumbnail_id'
   LEFT JOIN ${wpPrefix}postmeta alt
     ON alt.post_id = CAST(thumb.meta_value AS UNSIGNED)
    AND alt.meta_key = '_wp_attachment_image_alt'
   WHERE p.post_type = 'post'
     AND p.post_status = 'publish'`,
);
await wpConn.end();

// Map: WP post ID (as number) -> cleaned alt text or null
const wpAltByPostId = new Map();
for (const row of wpRows) {
  const id = Number(row.post_id);
  const cleaned = cleanAlt(row.alt_text);
  wpAltByPostId.set(id, cleaned); // may be null
}

// --- Pull our posts ------------------------------------------------------

const pg = postgres(pgUrl, { max: 1, ssl: "require" });
const ourRows = await pg`
  SELECT id, source_wp_id, slug, title
  FROM post
  WHERE source_wp_id IS NOT NULL
  ORDER BY source_wp_id ASC
`;

// --- Join + decide what to write per row --------------------------------

/** @type {Array<{id:string, slug:string, sourceWpId:number, source:'wp'|'title_fallback', alt:string}>} */
const plan = [];
const skipped = []; // rows we couldn't act on (shouldn't happen — every row has a title)

for (const r of ourRows) {
  const wpId = Number(r.source_wp_id);
  const wpAlt = wpAltByPostId.get(wpId) ?? null;
  let source = /** @type {'wp'|'title_fallback'} */ ("title_fallback");
  let alt = "";
  if (wpAlt) {
    source = "wp";
    alt = wpAlt;
  } else {
    source = "title_fallback";
    alt = cleanAlt(r.title) ?? "";
  }
  if (!alt) {
    skipped.push({ id: r.id, slug: r.slug, reason: "no source alt + no title" });
    continue;
  }
  plan.push({
    id: r.id,
    slug: r.slug,
    sourceWpId: wpId,
    source,
    alt,
  });
}

// --- Dry-run preview -----------------------------------------------------

if (!apply) {
  console.log(`DRY RUN — would update ${plan.length} rows.`);
  console.log("");
  console.log("First 5 rows by source_wp_id ASC:");
  console.log("slug | source | alt_text_to_write");
  console.log("---- | ------ | -----------------");
  for (const row of plan.slice(0, 5)) {
    console.log(`${row.slug} | ${row.source} | ${row.alt}`);
  }
  console.log("");
  console.log("First 5 WP-sourced rows (for sanity-check):");
  console.log("slug | source | alt_text_to_write");
  console.log("---- | ------ | -----------------");
  for (const row of plan.filter((r) => r.source === "wp").slice(0, 5)) {
    console.log(`${row.slug} | ${row.source} | ${row.alt}`);
  }
  console.log("");
  const wpCount = plan.filter((r) => r.source === "wp").length;
  const tfCount = plan.filter((r) => r.source === "title_fallback").length;
  console.log(`Summary: ${wpCount} WP / ${tfCount} title_fallback / ${skipped.length} skipped`);
  if (skipped.length > 0) {
    console.log(`Skipped IDs: ${skipped.map((s) => s.slug).join(", ")}`);
  }
  console.log("");
  console.log("Re-run with --apply to write.");
  await pg.end();
  process.exit(0);
}

// --- Apply mode ----------------------------------------------------------

let updated = 0;
let wpCount = 0;
let tfCount = 0;
let failed = 0;
const failures = [];

for (const row of plan) {
  try {
    const result = await pg`
      UPDATE post
      SET og_image_alt = ${row.alt}
      WHERE id = ${row.id}::uuid
    `;
    if (result.count > 0) {
      updated++;
      if (row.source === "wp") wpCount++;
      else tfCount++;
    } else {
      failed++;
      failures.push({ slug: row.slug, reason: "no row matched" });
    }
  } catch (err) {
    failed++;
    failures.push({ slug: row.slug, reason: err.message });
  }
}

await pg.end();

console.log("");
console.log("APPLY COMPLETE");
console.log(`Total rows updated:       ${updated}`);
console.log(`Used WP alt text:         ${wpCount}`);
console.log(`Used title fallback:      ${tfCount}`);
console.log(`Skipped (pre-update):     ${skipped.length}`);
console.log(`Failed during UPDATE:     ${failed}`);
if (skipped.length > 0) {
  console.log("");
  console.log("Skipped rows:");
  for (const s of skipped) console.log(`  ${s.slug}  (${s.reason})`);
}
if (failures.length > 0) {
  console.log("");
  console.log("Failed rows:");
  for (const f of failures) console.log(`  ${f.slug}  (${f.reason})`);
}

// --- Helpers -------------------------------------------------------------

/**
 * Normalise a raw alt-text candidate: decode HTML entities, strip HTML
 * tags, normalise whitespace, trim, truncate to ALT_MAX_LEN. Returns
 * null if the cleaned value is empty (so callers can fall through to
 * the next source priority).
 *
 * Entity decoding handles named entities common in WP / our migrated
 * titles (&amp; &lt; &gt; &quot; &apos;) plus numeric (&#NN; &#xHH;).
 * Without this, screen readers announce literals like "amp quot
 * semicolon" instead of the intended quotes.
 */
function cleanAlt(raw) {
  if (raw == null) return null;
  const decoded = decodeHtmlEntities(String(raw));
  const stripped = decoded.replace(/<[^>]*>/g, "");
  const trimmed = stripped.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, ALT_MAX_LEN);
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    // &amp; LAST so we don't double-decode (e.g. &amp;quot; → &quot; → ").
    .replace(/&amp;/g, "&");
}
