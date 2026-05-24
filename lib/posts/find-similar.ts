import "server-only";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { embedPostContent } from "../embeddings";
import { getDb } from "../db";
import { category, post } from "../db/schema";

// ============================================================================
// Shared ANN search primitive. ONE SQL builder, used by:
//
//   - lib/posts.ts#getReadNext        (per-post sibling search for /blog
//                                      read-next; passes the post's
//                                      stored embedding directly)
//   - lib/diagnostic/recommend.ts     (per-action retrieval for the
//                                      Executive AI Diagnostic report;
//                                      passes embedded action context)
//   - app/api/booking/[slug]/create   (single-query retrieval from
//                                      reasonInitial for confirmation
//                                      email recommendations)
//   - lib/posts-admin/similarity.ts   (admin "suggest internal links"
//                                      button; wraps findSimilarPosts
//                                      with visibility:'any' for unlisted)
//
// HNSW index `post_embedding_hnsw_idx` (m=16, ef_construction=64) serves
// all four. Sub-100ms at the current ~253-post scale.
//
// Embedding model: OpenAI text-embedding-3-large via OpenRouter, 1024
// dimensions. See lib/embeddings.ts for vendor rationale and cost.
// ============================================================================

/** Wide row returned by the private SQL builder. */
export interface SearchByEmbeddingRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  readingTimeMin: number;
  categoryName: string | null;
  ogImagePath: string | null;
  ogImageDeletedAt: Date | null;
  ogImageAlt: string | null;
  ogImageWidth: number | null;
  ogImageHeight: number | null;
  /** Cosine distance, 0 = identical, 2 = opposite. Lower = more similar. */
  distance: number;
}

export interface SearchByEmbeddingOptions {
  /** Post IDs to exclude from results. Default: empty. */
  excludePostIds?: string[];
  /**
   * Maximum cosine distance to accept. Posts beyond this are filtered.
   * Applied at the application layer because pgvector's HNSW index
   * doesn't support distance bounds in the ORDER BY; the index returns
   * ordered rows, so the filter is O(limit) cheap.
   * Default: no upper bound.
   */
  maxDistance?: number;
  /** Max results. Clamped to [1, 20]. Default 5. */
  limit?: number;
  /**
   * 'public' → WHERE visibility = 'listed' (default; what the /blog
   * surface shows). 'any' → no visibility filter (admin path can link
   * to unlisted campaign URLs).
   */
  visibility?: "public" | "any";
}

/**
 * Run an ANN search against post.embedding using the supplied 1024-dim
 * vector. Caller is responsible for sourcing the vector — either by
 * embedding query text via findSimilarPosts() below, or by loading a
 * post's stored embedding from the DB (as getReadNext does).
 *
 * Always filters to:
 *   - status = 'published'
 *   - archived_at IS NULL
 *   - embedding IS NOT NULL
 * Plus the optional visibility + excludePostIds filters.
 *
 * Returns rows ordered by cosine distance ascending (most similar first).
 */
export async function searchByEmbedding(
  vector: number[],
  opts: SearchByEmbeddingOptions = {},
): Promise<SearchByEmbeddingRow[]> {
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
  const excludePostIds = opts.excludePostIds ?? [];
  const visibility = opts.visibility ?? "public";

  // pgvector expects '[1.0,2.0,...]'::vector. sql.raw is safe here
  // because every element of the literal is a number from a trusted
  // source — either embedPostContent's API response or a post's stored
  // embedding column. User input never reaches this site directly.
  const literal = sql.raw(`'[${vector.join(",")}]'::vector`);

  const db = getDb();
  const rows = await db
    .select({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      readingTimeMin: post.readingTimeMin,
      categoryName: category.name,
      ogImagePath: post.ogImagePath,
      ogImageDeletedAt: post.ogImageDeletedAt,
      ogImageAlt: post.ogImageAlt,
      ogImageWidth: post.ogImageWidth,
      ogImageHeight: post.ogImageHeight,
      distance: sql<number>`${post.embedding} <=> ${literal}`,
    })
    .from(post)
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(
      and(
        eq(post.status, "published"),
        isNull(post.archivedAt),
        sql`${post.embedding} IS NOT NULL`,
        visibility === "public" ? eq(post.visibility, "listed") : undefined,
        excludePostIds.length > 0
          ? notInArray(post.id, excludePostIds)
          : undefined,
      ),
    )
    .orderBy(sql`${post.embedding} <=> ${literal}`)
    .limit(limit);

  // postgres.js returns numeric as string in some configurations; coerce.
  const coerced: SearchByEmbeddingRow[] = rows.map((r) => ({
    ...r,
    distance: typeof r.distance === "number" ? r.distance : Number(r.distance),
  }));

  if (typeof opts.maxDistance === "number") {
    return coerced.filter((r) => r.distance <= opts.maxDistance!);
  }
  return coerced;
}

// ============================================================================
// Public API for callers that have query TEXT (not a pre-computed vector).
// Embeds the text then runs searchByEmbedding. Returns a narrower public
// shape — callers that need the OG image fields should use
// searchByEmbedding directly (see lib/posts.ts#getReadNext).
// ============================================================================

export interface SimilarPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  categoryName: string | null;
  distance: number;
}

export interface FindSimilarPostsOptions {
  /** Text to embed and search against. */
  queryText: {
    title: string;
    excerpt?: string | null;
    contentMd?: string | null;
  };
  /** Post IDs to exclude. Default: empty. */
  excludePostIds?: string[];
  /** Max cosine distance. Default: no bound. */
  maxDistance?: number;
  /** Max results. Clamped to [1, 20]. Default 5. */
  limit?: number;
  /** Visibility filter. Default 'public'. */
  visibility?: "public" | "any";
}

/**
 * Embed the supplied query text and return the top-N most-similar
 * published posts.
 */
export async function findSimilarPosts(
  opts: FindSimilarPostsOptions,
): Promise<SimilarPost[]> {
  const vector = await embedPostContent(opts.queryText);
  const rows = await searchByEmbedding(vector, {
    excludePostIds: opts.excludePostIds,
    maxDistance: opts.maxDistance,
    limit: opts.limit,
    visibility: opts.visibility,
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    categoryName: r.categoryName,
    distance: r.distance,
  }));
}
