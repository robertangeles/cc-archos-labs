// insert.ts — write the migrated post to Archos Labs Postgres via Drizzle.
//
// Three operations per post:
//   1. ensureAuthor(post.author)       find-or-create by user_login slug
//   2. ensureCategory(post.category)   find-or-create by slug
//   3. upsertPost(post, authorId, categoryId)
//                                       SELECT-by-source_wp_id then INSERT-or-UPDATE
//   4. insertRevision(postId, post)    append-only audit trail
//
// Why SELECT-then-write instead of ON CONFLICT upsert? The schema's
// source_wp_id has a regular index, not a unique constraint. Adding the
// unique constraint would need another migration, and the migration
// script runs once with no concurrency — two extra DB reads per post
// (253 total) is irrelevant. Cleaner than coupling the script to a
// schema change.
//
// Idempotent: re-running the script on the same posts updates the same
// rows; never duplicates. The post_revision table receives a new audit
// row per run (intentional — captures every re-run as its own snapshot).

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import {
  author,
  category,
  post,
  postRevision,
} from "../../lib/db/schema";
import type { OgGeneratedPost } from "./types";

// =============================================================================
// DB connection
// =============================================================================

export interface DbHandle {
  db: ReturnType<typeof drizzle>;
  sql: ReturnType<typeof postgres>;
}

export function connectDb(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — migration cannot write.");
  }
  const sql = postgres(url, { ssl: "require", max: 1 });
  const db = drizzle(sql);
  return { db, sql };
}

export async function closeDb(handle: DbHandle): Promise<void> {
  await handle.sql.end();
}

// =============================================================================
// Author + Category find-or-create
// =============================================================================

/**
 * Find an author row by user_login slug, or insert one. Returns the
 * post-facing author UUID.
 *
 * `display_name` from WP is used verbatim today (which means "Sparq"
 * for Rob's account). After A3 seeds a deliberate public byline, this
 * function still finds the row by slug; the byline update is a separate
 * admin action.
 */
export async function ensureAuthor(
  db: DbHandle["db"],
  source: { userLogin: string; displayName: string },
): Promise<string> {
  const slug = normaliseSlug(source.userLogin);
  const existing = await db
    .select({ id: author.id })
    .from(author)
    .where(eq(author.slug, slug))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [inserted] = await db
    .insert(author)
    .values({
      slug,
      name: source.displayName,
      bioMd: "",
      photoUrl: null,
      linkedinUrl: null,
    })
    .returning({ id: author.id });
  return inserted.id;
}

export async function ensureCategory(
  db: DbHandle["db"],
  source: { name: string; slug: string },
): Promise<string> {
  const slug = normaliseSlug(source.slug);
  const existing = await db
    .select({ id: category.id })
    .from(category)
    .where(eq(category.slug, slug))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [inserted] = await db
    .insert(category)
    .values({
      slug,
      name: source.name,
      description: null,
    })
    .returning({ id: category.id });
  return inserted.id;
}

// =============================================================================
// Post upsert
// =============================================================================

export interface UpsertResult {
  postId: string;
  inserted: boolean; // true = INSERT, false = UPDATE
  diffSizePct: number; // 0-100; 100 on first insert
}

export async function upsertPost(
  db: DbHandle["db"],
  data: OgGeneratedPost,
  authorId: string,
  categoryId: string,
  filteredTags: string[],
): Promise<UpsertResult> {
  const existing = await db
    .select({
      id: post.id,
      contentMd: post.contentMd,
    })
    .from(post)
    .where(eq(post.sourceWpId, data.sourceWpId))
    .limit(1);

  // Use rehosted markdown (R2 image URLs) for content_md; the original
  // `data.contentMd` from transform stage points at WP host URLs which
  // will 404 once WP is decommissioned.
  const contentMd = data.contentMdRehosted || data.contentMd;

  const baseValues = {
    slug: data.slug,
    title: data.title,
    excerpt: data.excerpt || null,
    contentMd,
    seoTitle: null, // inventory showed only 1 post had a custom Yoast title
    seoDescription: null,
    ogImagePath: data.ogImagePath || data.featuredImageR2Url || null,
    ogImageGeneratedAt:
      data.ogImageGeneratedAt.getTime() > 0
        ? data.ogImageGeneratedAt
        : null,
    authorId,
    categoryId,
    tags: filteredTags,
    status: "published" as const,
    visibility: "listed" as const,
    embedding: data.embedding,
    wordCount: data.wordCount,
    readingTimeMin: data.readingTimeMin,
    needsReview: data.needsReview,
    sourceWpId: data.sourceWpId,
    lastReviewedAt: data.modifiedAt,
    publishedAt: data.publishedAt,
    archivedAt: null,
    updatedAt: new Date(),
  };

  if (existing.length > 0) {
    const existingRow = existing[0];
    const diffSizePct = computeDiffSizePct(
      existingRow.contentMd,
      contentMd,
    );
    await db
      .update(post)
      .set(baseValues)
      .where(eq(post.id, existingRow.id));
    return {
      postId: existingRow.id,
      inserted: false,
      diffSizePct,
    };
  }

  const [inserted] = await db
    .insert(post)
    .values(baseValues)
    .returning({ id: post.id });
  return {
    postId: inserted.id,
    inserted: true,
    diffSizePct: 100, // first-ever insert: full content change
  };
}

// =============================================================================
// Revision (append-only audit)
// =============================================================================

export async function insertRevision(
  db: DbHandle["db"],
  postId: string,
  data: OgGeneratedPost,
  contentMd: string,
  diffSizePct: number,
): Promise<void> {
  await db.insert(postRevision).values({
    postId,
    title: data.title,
    contentMd,
    excerpt: data.excerpt || null,
    seoTitle: null,
    seoDescription: null,
    diffSizePct: diffSizePct.toFixed(2),
    savedBy: "migrate-wp",
  });
}

// =============================================================================
// Helpers
// =============================================================================

function normaliseSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/**
 * Cheap content-change magnitude indicator. Uses length-delta as a proxy
 * for actual diff — mirrors the heuristic in lib/pages for page revisions.
 * Returns 0-100; values >= 5 flag "material change" for admin attention.
 */
function computeDiffSizePct(prev: string, next: string): number {
  if (!prev) return 100;
  if (prev === next) return 0;
  const delta = Math.abs(next.length - prev.length);
  const pct = (delta / Math.max(prev.length, 1)) * 100;
  return Math.min(100, Math.round(pct * 100) / 100);
}

export class InsertError extends Error {
  constructor(
    public readonly sourceWpId: number,
    message: string,
  ) {
    super(`[post #${sourceWpId}] ${message}`);
    this.name = "InsertError";
  }
}
