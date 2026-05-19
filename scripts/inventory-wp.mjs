// Read-only inventory of the source WordPress database used for the
// Translation Layer migration (rosy-bee). Run BEFORE writing the actual
// migration script in scripts/migrate-wp/ — the output tells us what's
// really in the DB so the transform pipeline doesn't hit walls later.
//
// Usage:
//   pnpm inventory:wp [--output wiki/raw-index/wp-inventory-YYYY-MM-DD.md]
//
// Required env (.env.local):
//   WP_DATABASE_URL   mysql://user:pass@host:port/dbname
//   WP_TABLE_PREFIX   default 'wp_'; robertangeles.com uses 'uhiz_'
//
// Safety posture:
//   - This script runs SELECTs only. No INSERT/UPDATE/DELETE/DDL.
//   - It will REFUSE to run if WP_DATABASE_URL points at the Archos Labs
//     Postgres (looks for "postgres://" or "render.com" in the URL).
//   - Connections are read-only mysql2/promise; query timeout 30s each.
//
// Output:
//   - Markdown report to stdout
//   - When --output PATH is provided, the same content is written there
//     (parent dir is created if missing)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { argv, env, exit } from "node:process";
import mysql from "mysql2/promise";

// -----------------------------------------------------------------------------
// CLI + env parsing
// -----------------------------------------------------------------------------

const url = env.WP_DATABASE_URL;
if (!url) {
  console.error(
    "ERROR: WP_DATABASE_URL is not set. Add it to .env.local (see .env.example).",
  );
  exit(1);
}

// Guard rail: never accidentally point at Archos Labs Postgres.
if (
  url.startsWith("postgres://") ||
  url.startsWith("postgresql://") ||
  url.includes("render.com")
) {
  console.error(
    "ERROR: WP_DATABASE_URL looks like a Postgres or Render URL. This script reads MySQL only.",
  );
  exit(1);
}

const prefix = env.WP_TABLE_PREFIX || "wp_";
// Whitelist: prefix must match standard WP naming. Refuse anything else
// so the prefix can be safely interpolated into table names below.
if (!/^[a-z0-9_]{1,32}_$/.test(prefix)) {
  console.error(
    `ERROR: WP_TABLE_PREFIX ${JSON.stringify(prefix)} is not a valid WP prefix.`,
  );
  exit(1);
}

const outputArgIdx = argv.indexOf("--output");
const outputPath =
  outputArgIdx >= 0 && argv[outputArgIdx + 1] ? argv[outputArgIdx + 1] : null;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
const lines = [];
const out = (s = "") => lines.push(s);

function table(headers, rows) {
  out(`| ${headers.join(" | ")} |`);
  out(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    out(`| ${r.map((c) => String(c ?? "")).join(" | ")} |`);
  }
  out();
}

// -----------------------------------------------------------------------------
// Run the inventory
// -----------------------------------------------------------------------------

let conn;
try {
  conn = await mysql.createConnection({
    uri: url,
    // Conservative timeouts. We're reading a small WP DB.
    connectTimeout: 10_000,
  });

  // 30-second statement timeout (MySQL 5.7.4+). Safe no-op on older.
  try {
    await conn.query("SET SESSION MAX_EXECUTION_TIME = 30000");
  } catch {
    /* MySQL < 5.7.4 — ignore */
  }

  out(`# WordPress Inventory — robertangeles.com`);
  out();
  out(`Generated: ${today} by \`scripts/inventory-wp.mjs\``);
  out(`Table prefix: \`${prefix}\``);
  out();

  // -----------------------------------------------------
  // 1. Schema presence — confirm WP tables exist
  // -----------------------------------------------------
  out(`## 1. Schema presence`);
  out();
  const [tables] = await conn.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
  );
  const tableNames = new Set(
    tables.map((r) => (r.table_name || r.TABLE_NAME).toLowerCase()),
  );
  const expected = [
    `${prefix}posts`,
    `${prefix}postmeta`,
    `${prefix}terms`,
    `${prefix}term_taxonomy`,
    `${prefix}term_relationships`,
    `${prefix}users`,
    `${prefix}options`,
  ];
  const found = expected.filter((t) => tableNames.has(t.toLowerCase()));
  const missing = expected.filter((t) => !tableNames.has(t.toLowerCase()));
  out(`Found: ${found.length} of ${expected.length} expected core WP tables.`);
  if (missing.length > 0) {
    out(`Missing: ${missing.map((t) => `\`${t}\``).join(", ")}`);
    out(
      `If the prefix is wrong, re-run with \`WP_TABLE_PREFIX=...\`. Detected tables in this DB:`,
    );
    out("```");
    for (const t of [...tableNames].sort().slice(0, 30)) out(t);
    if (tableNames.size > 30) out(`... and ${tableNames.size - 30} more`);
    out("```");
    out();
    out("Aborting inventory — fix prefix and re-run.");
    exit(1);
  }
  out();

  // -----------------------------------------------------
  // 2. Posts by type × status
  // -----------------------------------------------------
  out(`## 2. Posts by type × status`);
  out();
  const [byType] = await conn.query(
    `SELECT post_type, post_status, COUNT(*) AS n
     FROM \`${prefix}posts\`
     GROUP BY post_type, post_status
     ORDER BY n DESC`,
  );
  table(
    ["post_type", "post_status", "count"],
    byType.map((r) => [r.post_type, r.post_status, r.n]),
  );
  const totalPublished = byType
    .filter((r) => r.post_type === "post" && r.post_status === "publish")
    .reduce((s, r) => s + Number(r.n), 0);
  out(`**Published posts (post_type='post', post_status='publish'): ${totalPublished}**`);
  out();

  // -----------------------------------------------------
  // 3. Date range of published posts
  // -----------------------------------------------------
  out(`## 3. Date range (published posts)`);
  out();
  const [[range]] = await conn.query(
    `SELECT MIN(post_date) AS earliest, MAX(post_date) AS latest
     FROM \`${prefix}posts\`
     WHERE post_type='post' AND post_status='publish'`,
  );
  out(`- Earliest: ${range.earliest ?? "—"}`);
  out(`- Latest: ${range.latest ?? "—"}`);
  out();

  // -----------------------------------------------------
  // 4. Content length stats
  // -----------------------------------------------------
  out(`## 4. Content length (published posts)`);
  out();
  const [[len]] = await conn.query(
    `SELECT
       ROUND(AVG(CHAR_LENGTH(post_content))) AS avg_chars,
       MIN(CHAR_LENGTH(post_content)) AS min_chars,
       MAX(CHAR_LENGTH(post_content)) AS max_chars,
       COUNT(*) AS n
     FROM \`${prefix}posts\`
     WHERE post_type='post' AND post_status='publish'`,
  );
  out(`- Count: ${len.n}`);
  out(`- Avg length: ${len.avg_chars} chars (~${Math.round((len.avg_chars || 0) / 5)} words)`);
  out(`- Min length: ${len.min_chars} chars`);
  out(`- Max length: ${len.max_chars} chars`);
  out();

  // -----------------------------------------------------
  // 5. Categories with counts
  // -----------------------------------------------------
  out(`## 5. Categories (with published-post counts)`);
  out();
  const [cats] = await conn.query(
    `SELECT t.name, t.slug, COUNT(p.ID) AS n
     FROM \`${prefix}terms\` t
     JOIN \`${prefix}term_taxonomy\` tt ON t.term_id = tt.term_id
     LEFT JOIN \`${prefix}term_relationships\` tr ON tt.term_taxonomy_id = tr.term_taxonomy_id
     LEFT JOIN \`${prefix}posts\` p ON tr.object_id = p.ID
       AND p.post_type='post' AND p.post_status='publish'
     WHERE tt.taxonomy='category'
     GROUP BY t.term_id, t.name, t.slug
     ORDER BY n DESC, t.name`,
  );
  table(
    ["category", "slug", "post count"],
    cats.map((c) => [c.name, c.slug, c.n]),
  );

  // -----------------------------------------------------
  // 6. Tags with counts
  // -----------------------------------------------------
  out(`## 6. Tags (with published-post counts)`);
  out();
  const [tags] = await conn.query(
    `SELECT t.name, t.slug, COUNT(p.ID) AS n
     FROM \`${prefix}terms\` t
     JOIN \`${prefix}term_taxonomy\` tt ON t.term_id = tt.term_id
     LEFT JOIN \`${prefix}term_relationships\` tr ON tt.term_taxonomy_id = tr.term_taxonomy_id
     LEFT JOIN \`${prefix}posts\` p ON tr.object_id = p.ID
       AND p.post_type='post' AND p.post_status='publish'
     WHERE tt.taxonomy='post_tag'
     GROUP BY t.term_id, t.name, t.slug
     ORDER BY n DESC, t.name`,
  );
  table(
    ["tag", "slug", "post count"],
    tags.map((t) => [t.name, t.slug, t.n]),
  );

  // -----------------------------------------------------
  // 7. Authors with published counts
  // -----------------------------------------------------
  out(`## 7. Authors (with published-post counts)`);
  out();
  const [authors] = await conn.query(
    `SELECT u.ID, u.display_name, u.user_login, COUNT(p.ID) AS n
     FROM \`${prefix}users\` u
     LEFT JOIN \`${prefix}posts\` p ON u.ID = p.post_author
       AND p.post_type='post' AND p.post_status='publish'
     GROUP BY u.ID, u.display_name, u.user_login
     ORDER BY n DESC`,
  );
  table(
    ["display_name", "user_login", "published_count"],
    authors.map((a) => [a.display_name, a.user_login, a.n]),
  );

  // -----------------------------------------------------
  // 8. Featured-image coverage
  // -----------------------------------------------------
  out(`## 8. Featured image coverage`);
  out();
  const [[fi]] = await conn.query(
    `SELECT
       COUNT(DISTINCT p.ID) AS published_total,
       COUNT(DISTINCT pm.post_id) AS with_thumb
     FROM \`${prefix}posts\` p
     LEFT JOIN \`${prefix}postmeta\` pm
       ON p.ID = pm.post_id AND pm.meta_key='_thumbnail_id'
     WHERE p.post_type='post' AND p.post_status='publish'`,
  );
  out(`- Published posts: ${fi.published_total}`);
  out(`- With featured image: ${fi.with_thumb} (${
    fi.published_total ? Math.round((fi.with_thumb / fi.published_total) * 100) : 0
  }%)`);
  out();

  // -----------------------------------------------------
  // 9. Yoast SEO meta coverage
  // -----------------------------------------------------
  out(`## 9. Yoast SEO meta coverage`);
  out();
  const [[yoast]] = await conn.query(
    `SELECT
       SUM(meta_key='_yoast_wpseo_title') AS custom_title,
       SUM(meta_key='_yoast_wpseo_metadesc') AS custom_metadesc,
       SUM(meta_key='_yoast_wpseo_focuskw') AS focus_keyphrase
     FROM \`${prefix}postmeta\` pm
     JOIN \`${prefix}posts\` p ON pm.post_id = p.ID
     WHERE p.post_type='post' AND p.post_status='publish'`,
  );
  out(`- Custom SEO title: ${yoast.custom_title || 0} posts`);
  out(`- Custom SEO description: ${yoast.custom_metadesc || 0} posts`);
  out(`- Focus keyphrase: ${yoast.focus_keyphrase || 0} posts`);
  out();

  // -----------------------------------------------------
  // 10. Shortcode prevalence (top 15)
  // -----------------------------------------------------
  out(`## 10. Shortcode prevalence in published post bodies`);
  out();
  const shortcodes = [
    "caption",
    "gallery",
    "embed",
    "video",
    "audio",
    "youtube",
    "code",
    "contact-form-7",
    "vc_row",
    "vc_column",
    "vc_column_text",
    "vc_single_image",
    "vc_video",
    "vc_btn",
    "edge_",
  ];
  const shortcodeRows = [];
  for (const sc of shortcodes) {
    const [[hit]] = await conn.query(
      `SELECT COUNT(*) AS posts_with
       FROM \`${prefix}posts\`
       WHERE post_type='post' AND post_status='publish'
         AND post_content LIKE ?`,
      [`%[${sc}%`],
    );
    if (hit.posts_with > 0) {
      shortcodeRows.push([`[${sc}…]`, hit.posts_with]);
    }
  }
  if (shortcodeRows.length === 0) {
    out("(No common shortcodes detected in any published post body.)");
    out();
  } else {
    table(["shortcode", "posts containing"], shortcodeRows);
  }

  // -----------------------------------------------------
  // 11. Permalink structure
  // -----------------------------------------------------
  out(`## 11. Permalink structure`);
  out();
  const [permalinkRows] = await conn.query(
    `SELECT option_value FROM \`${prefix}options\` WHERE option_name='permalink_structure'`,
  );
  out(
    `- \`permalink_structure\` = \`${permalinkRows[0]?.option_value ?? "(empty / default plain)"}\``,
  );
  out();

  // -----------------------------------------------------
  // 12. Revisions
  // -----------------------------------------------------
  out(`## 12. Revisions`);
  out();
  const [[rev]] = await conn.query(
    `SELECT COUNT(*) AS n FROM \`${prefix}posts\` WHERE post_type='revision'`,
  );
  out(
    `- ${rev.n} revision rows (migration will filter these out via \`post_type IN ('post', 'page')\` filter).`,
  );
  out();

  // -----------------------------------------------------
  // 13. Attachments
  // -----------------------------------------------------
  out(`## 13. Attachments (media library entries)`);
  out();
  const [[att]] = await conn.query(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT post_mime_type) AS mime_types
     FROM \`${prefix}posts\` WHERE post_type='attachment'`,
  );
  out(`- Attachment rows: ${att.n} (vs ${"2,734"} files in uploads/ — diff = thumbnails)`);
  out(`- Distinct MIME types: ${att.mime_types}`);
  out();
  const [mimes] = await conn.query(
    `SELECT post_mime_type, COUNT(*) AS n
     FROM \`${prefix}posts\` WHERE post_type='attachment'
     GROUP BY post_mime_type ORDER BY n DESC LIMIT 10`,
  );
  table(["mime_type", "count"], mimes.map((m) => [m.post_mime_type, m.n]));

  // -----------------------------------------------------
  // 14. Custom post types beyond post/page/attachment/revision
  // -----------------------------------------------------
  out(`## 14. Custom post types`);
  out();
  const [cpts] = await conn.query(
    `SELECT post_type, COUNT(*) AS n
     FROM \`${prefix}posts\`
     WHERE post_type NOT IN ('post','page','attachment','revision','nav_menu_item')
     GROUP BY post_type ORDER BY n DESC`,
  );
  if (cpts.length === 0) {
    out("(No custom post types beyond the WP standard set.)");
    out();
  } else {
    table(["post_type", "count"], cpts.map((c) => [c.post_type, c.n]));
    out(
      "**Decision needed:** which of these custom types should the migration script include? Defaults to `post` only.",
    );
    out();
  }

  // -----------------------------------------------------
  // 15. Sample of post titles (most recent 10 published)
  // -----------------------------------------------------
  out(`## 15. Sample: 10 most recent published posts`);
  out();
  const [sample] = await conn.query(
    `SELECT post_date, post_title, post_name
     FROM \`${prefix}posts\`
     WHERE post_type='post' AND post_status='publish'
     ORDER BY post_date DESC LIMIT 10`,
  );
  table(
    ["date", "title", "slug"],
    sample.map((s) => [
      String(s.post_date).slice(0, 10),
      s.post_title,
      s.post_name,
    ]),
  );

  // -----------------------------------------------------
  // 16. Wrap-up
  // -----------------------------------------------------
  out(`---`);
  out();
  out(
    `Inventory complete. Use this as input to **Phase A4** (writing \`scripts/migrate-wp/\`). Frozen snapshot — commit alongside the migration script work.`,
  );
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  if (err.code === "ECONNREFUSED") {
    console.error(
      "Connection refused. Is the MySQL server running locally? Check WP_DATABASE_URL host + port.",
    );
  } else if (err.code === "ER_ACCESS_DENIED_ERROR") {
    console.error(
      "Access denied. Check the user + password in WP_DATABASE_URL match what wp-config.php uses.",
    );
  }
  exit(1);
} finally {
  if (conn) await conn.end();
}

// -----------------------------------------------------------------------------
// Emit
// -----------------------------------------------------------------------------

const report = lines.join("\n") + "\n";
process.stdout.write(report);

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report);
  console.error(`\nWritten to ${outputPath}`);
}
