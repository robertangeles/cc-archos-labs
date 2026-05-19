// extract.ts — pull typed records from the source WordPress MySQL.
//
// One-shot read of every published post + its author + category + tags +
// featured image URL + Yoast focus keyphrase. Returns a typed
// ExtractedPost[] for the rest of the pipeline to consume.
//
// Query strategy: avoid N+1. Run one main query for posts (joined with
// users for the author and with attachments for the featured image),
// then batch-fetch the supporting taxonomy + meta tables filtered to the
// extracted post IDs. Final assembly is in-memory.
//
// Read-only. Will reject any non-mysql:// URL or a URL pointing at a
// Postgres / Render host (defensive guard against accidentally targeting
// the wrong database).

import mysql from "mysql2/promise";
import type { Connection } from "mysql2/promise";
import type {
  ExtractedPost,
  WpAuthorRow,
  WpCategoryRow,
  WpFeaturedImage,
  WpPostRow,
} from "./types";

const PREFIX_RE = /^[a-z0-9_]{1,32}_$/;

export interface ExtractOptions {
  limit?: number | null;
  /** If provided, return only the post with this WP `post_name` (slug). */
  slug?: string | null;
}

/**
 * Open a read-only connection to the WP MySQL. Refuses to connect if the
 * URL looks like a Postgres / Render endpoint (defensive — the migration
 * script's two DBs share env-var conventions and accidents are bad).
 */
export async function connectWp(url: string): Promise<Connection> {
  if (!url) throw new Error("WP_DATABASE_URL is not set.");
  if (
    url.startsWith("postgres://") ||
    url.startsWith("postgresql://") ||
    url.includes("render.com")
  ) {
    throw new Error(
      "WP_DATABASE_URL looks like a Postgres/Render URL. Refusing to run.",
    );
  }
  const conn = await mysql.createConnection({
    uri: url,
    connectTimeout: 10_000,
    // Treat DATETIMEs as JS Date objects (default; explicit for clarity).
    dateStrings: false,
  });
  // 30-second per-statement timeout (no-op on older MySQL).
  try {
    await conn.query("SET SESSION MAX_EXECUTION_TIME = 30000");
  } catch {
    /* MySQL < 5.7.4 */
  }
  return conn;
}

interface CorePostRow {
  ID: number;
  post_author: number;
  post_date: Date;
  post_modified: Date;
  post_content: string;
  post_title: string;
  post_excerpt: string;
  post_name: string;
  user_login: string;
  display_name: string;
  thumbnail_id: number | null;
  featured_image_url: string | null;
}

/**
 * Pull all published posts joined with author + featured image. One row
 * per post; downstream functions fetch supporting taxonomy + meta in
 * separate batched queries keyed by the post-id list.
 */
async function fetchCorePosts(
  conn: Connection,
  prefix: string,
  opts: ExtractOptions,
): Promise<CorePostRow[]> {
  const limitClause = opts.limit ? `LIMIT ${Math.floor(opts.limit)}` : "";
  const slugClause = opts.slug ? `AND p.post_name = ?` : "";
  const params: unknown[] = [];
  if (opts.slug) params.push(opts.slug);

  // The CAST(... AS UNSIGNED) on _thumbnail_id is essential — WP stores
  // it as a varchar in postmeta. Without the cast, the JOIN silently
  // fails on collation comparison.
  const [rows] = await conn.query(
    `SELECT
       p.ID, p.post_author, p.post_date, p.post_modified,
       p.post_content, p.post_title, p.post_excerpt, p.post_name,
       u.user_login, u.display_name,
       CAST(pm_thumb.meta_value AS UNSIGNED) AS thumbnail_id,
       ai.guid AS featured_image_url
     FROM \`${prefix}posts\` p
     LEFT JOIN \`${prefix}users\` u ON u.ID = p.post_author
     LEFT JOIN \`${prefix}postmeta\` pm_thumb
       ON pm_thumb.post_id = p.ID AND pm_thumb.meta_key = '_thumbnail_id'
     LEFT JOIN \`${prefix}posts\` ai
       ON ai.ID = CAST(pm_thumb.meta_value AS UNSIGNED)
          AND ai.post_type = 'attachment'
     WHERE p.post_type = 'post'
       AND p.post_status = 'publish'
       ${slugClause}
     ORDER BY p.post_date DESC
     ${limitClause}`,
    params,
  );
  return rows as CorePostRow[];
}

interface TermRow {
  post_id: number;
  term_id: number;
  name: string;
  slug: string;
  taxonomy: string; // 'category' | 'post_tag'
}

/**
 * Fetch all (post → term) relationships for the given post IDs.
 * Returns a flat list; caller groups by post_id and splits by taxonomy.
 */
async function fetchTerms(
  conn: Connection,
  prefix: string,
  postIds: number[],
): Promise<TermRow[]> {
  if (postIds.length === 0) return [];
  const [rows] = await conn.query(
    `SELECT tr.object_id AS post_id, t.term_id, t.name, t.slug, tt.taxonomy
     FROM \`${prefix}term_relationships\` tr
     JOIN \`${prefix}term_taxonomy\` tt
       ON tr.term_taxonomy_id = tt.term_taxonomy_id
     JOIN \`${prefix}terms\` t ON tt.term_id = t.term_id
     WHERE tr.object_id IN (?)
       AND tt.taxonomy IN ('category', 'post_tag')`,
    [postIds],
  );
  return rows as TermRow[];
}

/**
 * For posts with multiple categories assigned, Yoast tracks which one is
 * the "primary" in its own table. Per 2026-05-19 inventory there are
 * effectively no multi-category published posts, but we honour the
 * primary table when present as a safety net.
 *
 * Returns Map<postId, primaryCategoryTermId>.
 */
async function fetchPrimaryCategories(
  conn: Connection,
  prefix: string,
  postIds: number[],
): Promise<Map<number, number>> {
  if (postIds.length === 0) return new Map();
  // The table name includes the prefix but the column conventions are
  // Yoast's. If the table doesn't exist (older Yoast install), return
  // an empty map — caller falls back to first category.
  try {
    const [rows] = await conn.query(
      `SELECT post_id, term_id
       FROM \`${prefix}yoast_primary_term\`
       WHERE taxonomy = 'category' AND post_id IN (?)`,
      [postIds],
    );
    const map = new Map<number, number>();
    for (const r of rows as Array<{ post_id: number; term_id: number }>) {
      map.set(r.post_id, r.term_id);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Fetch `_yoast_wpseo_focuskw` postmeta entries for the given posts. */
async function fetchFocusKeyphrases(
  conn: Connection,
  prefix: string,
  postIds: number[],
): Promise<Map<number, string>> {
  if (postIds.length === 0) return new Map();
  const [rows] = await conn.query(
    `SELECT post_id, meta_value
     FROM \`${prefix}postmeta\`
     WHERE meta_key = '_yoast_wpseo_focuskw' AND post_id IN (?)`,
    [postIds],
  );
  const map = new Map<number, string>();
  for (const r of rows as Array<{ post_id: number; meta_value: string }>) {
    if (r.meta_value && r.meta_value.trim()) {
      map.set(r.post_id, r.meta_value.trim());
    }
  }
  return map;
}

/** Fetch `_wp_attachment_image_alt` for the given attachment IDs. */
async function fetchAttachmentAltText(
  conn: Connection,
  prefix: string,
  attachmentIds: number[],
): Promise<Map<number, string>> {
  if (attachmentIds.length === 0) return new Map();
  const [rows] = await conn.query(
    `SELECT post_id, meta_value
     FROM \`${prefix}postmeta\`
     WHERE meta_key = '_wp_attachment_image_alt' AND post_id IN (?)`,
    [attachmentIds],
  );
  const map = new Map<number, string>();
  for (const r of rows as Array<{ post_id: number; meta_value: string }>) {
    if (r.meta_value && r.meta_value.trim()) {
      map.set(r.post_id, r.meta_value.trim());
    }
  }
  return map;
}

/**
 * Main entry: assemble the typed ExtractedPost[] from all the sub-queries.
 */
export async function extractPosts(
  conn: Connection,
  prefix: string,
  opts: ExtractOptions = {},
): Promise<ExtractedPost[]> {
  if (!PREFIX_RE.test(prefix)) {
    throw new Error(`Invalid WP_TABLE_PREFIX: ${JSON.stringify(prefix)}`);
  }

  const core = await fetchCorePosts(conn, prefix, opts);
  if (core.length === 0) return [];

  const postIds = core.map((r) => r.ID);
  const attachmentIds = core
    .map((r) => r.thumbnail_id)
    .filter((id): id is number => typeof id === "number");

  // Run the supporting queries in parallel.
  const [terms, primaryCats, focusKeyphrases, altTexts] = await Promise.all([
    fetchTerms(conn, prefix, postIds),
    fetchPrimaryCategories(conn, prefix, postIds),
    fetchFocusKeyphrases(conn, prefix, postIds),
    fetchAttachmentAltText(conn, prefix, attachmentIds),
  ]);

  // Group terms by post_id, split by taxonomy.
  const termsByPost = new Map<
    number,
    { categories: TermRow[]; tags: TermRow[] }
  >();
  for (const t of terms) {
    let bucket = termsByPost.get(t.post_id);
    if (!bucket) {
      bucket = { categories: [], tags: [] };
      termsByPost.set(t.post_id, bucket);
    }
    if (t.taxonomy === "category") bucket.categories.push(t);
    else if (t.taxonomy === "post_tag") bucket.tags.push(t);
  }

  // Final assembly.
  const out: ExtractedPost[] = [];
  for (const row of core) {
    const bucket = termsByPost.get(row.ID) ?? {
      categories: [],
      tags: [],
    };
    const primaryTermId = primaryCats.get(row.ID);
    // Pick the primary category if Yoast set one, otherwise the first.
    // If a post has zero categories (shouldn't happen for published
    // posts per inventory), we skip the post — log + caller decides.
    let category = primaryTermId
      ? bucket.categories.find((c) => c.term_id === primaryTermId)
      : undefined;
    category = category ?? bucket.categories[0];
    if (!category) {
      // Defensive — flag in manifest. Skipping silently is wrong; we
      // throw and let the orchestrator catch + log + continue.
      throw new ExtractError(
        row.ID,
        `Post has no category assigned (inventory said 100% have one).`,
      );
    }

    let featuredImage: WpFeaturedImage | null = null;
    if (row.thumbnail_id && row.featured_image_url) {
      featuredImage = {
        attachment_id: row.thumbnail_id,
        source_url: row.featured_image_url,
        alt_text: altTexts.get(row.thumbnail_id) ?? null,
      };
    }

    // Defensive trim on every WP-sourced string. The 2026-05-19 dry-run
    // surfaced a leading space in post_title (" AI Readiness…") — WP
    // stores trailing whitespace inconsistently and phpMyAdmin's UI
    // trims it on display, so it wasn't visible during the inventory.
    // We render these verbatim downstream (h1 title, og meta, slug
    // attributes) so any leading/trailing whitespace is a visible bug.
    out.push({
      sourceWpId: row.ID,
      slug: (row.post_name ?? "").trim(),
      title: (row.post_title ?? "").trim(),
      rawHtml: row.post_content ?? "",
      rawExcerpt: (row.post_excerpt ?? "").trim(),
      publishedAt: toDate(row.post_date),
      modifiedAt: toDate(row.post_modified),
      author: {
        sourceUserId: row.post_author,
        userLogin: (row.user_login ?? "").trim(),
        displayName: (row.display_name ?? "").trim(),
      },
      category: {
        sourceTermId: category.term_id,
        name: category.name.trim(),
        slug: category.slug.trim(),
      },
      tags: bucket.tags.map((t) => ({
        sourceTermId: t.term_id,
        name: t.name.trim(),
        slug: t.slug.trim(),
      })),
      featuredImage,
      yoastFocusKeyphrase: focusKeyphrases.get(row.ID) ?? null,
    });
  }
  return out;
}

/**
 * Sentinel exception class so the orchestrator can catch per-post extract
 * failures and log them to the manifest without aborting the whole run.
 */
export class ExtractError extends Error {
  constructor(
    public readonly sourceWpId: number,
    message: string,
  ) {
    super(`[post #${sourceWpId}] ${message}`);
    this.name = "ExtractError";
  }
}

function toDate(v: Date | string): Date {
  if (v instanceof Date) return v;
  return new Date(v);
}

// =============================================================================
// Aggregate tag-frequency lookup (used by transform-stage tag filter)
// =============================================================================

/**
 * Returns a map of tag slug → published-post count across ALL published
 * posts (not just the limited set being extracted). Used to filter the
 * long tail of single-use tags per Phase A4 decision (count >= 2).
 *
 * Per 2026-05-19 inventory: 740 tags total, top 14 carry the bulk,
 * ~700 are single-use sprawl that we drop.
 */
export async function fetchTagFrequencies(
  conn: Connection,
  prefix: string,
): Promise<Map<string, number>> {
  const [rows] = await conn.query(
    `SELECT t.slug, COUNT(p.ID) AS n
     FROM \`${prefix}terms\` t
     JOIN \`${prefix}term_taxonomy\` tt ON t.term_id = tt.term_id
     LEFT JOIN \`${prefix}term_relationships\` tr
       ON tt.term_taxonomy_id = tr.term_taxonomy_id
     LEFT JOIN \`${prefix}posts\` p ON tr.object_id = p.ID
       AND p.post_type = 'post' AND p.post_status = 'publish'
     WHERE tt.taxonomy = 'post_tag'
     GROUP BY t.term_id, t.slug`,
  );
  const map = new Map<string, number>();
  for (const r of rows as Array<{ slug: string; n: number | string }>) {
    map.set(r.slug, Number(r.n));
  }
  return map;
}

// Re-export for callers that don't need the row-level types.
export type { ExtractedPost, WpAuthorRow, WpCategoryRow, WpPostRow };
