import "server-only";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "./db";
import { author, category, post } from "./db/schema";

// Steady-state read queries for the public /blog surface and sitemap /
// llms.txt feeds. Write side lives in scripts/migrate-wp/insert.ts and
// (Phase 3) app/api/admin/posts/*.
//
// Public-reader filter (used everywhere except getPostBySlug):
//   WHERE status = 'published'
//     AND visibility = 'listed'
//     AND archived_at IS NULL
//
// Direct-URL reader filter (getPostBySlug — preserves SEO equity for old
// links into unlisted posts):
//   WHERE status = 'published'
//     AND archived_at IS NULL
// Visibility is ignored here intentionally; admin can render an unlisted
// post that's been intentionally surfaced via a campaign URL.

export interface PublishedPostListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  ogImagePath: string | null;
  readingTimeMin: number;
  publishedAt: Date;
  lastReviewedAt: Date | null;
  categorySlug: string | null;
  categoryName: string | null;
  authorSlug: string | null;
  authorName: string | null;
}

export interface PublishedPostView extends PublishedPostListItem {
  contentMd: string;
  seoTitle: string | null;
  seoDescription: string | null;
  tags: string[];
  wordCount: number;
  needsReview: boolean;
  authorBioMd: string | null;
  authorPhotoUrl: string | null;
  authorLinkedinUrl: string | null;
  categoryDescription: string | null;
  ogImageGeneratedAt: Date | null;
}

export interface ReadNextItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  categoryName: string | null;
  readingTimeMin: number;
}

const PUBLIC_LISTED_FILTER = and(
  eq(post.status, "published"),
  eq(post.visibility, "listed"),
  isNull(post.archivedAt),
);

const PUBLIC_DIRECT_FILTER = and(
  eq(post.status, "published"),
  isNull(post.archivedAt),
);

/**
 * Fetch a single post for /blog/[slug]. Includes the full author + category
 * payloads needed for the article page (bio, photo, JSON-LD Person schema).
 * Returns null when no published post exists at this slug (caller renders
 * notFound()).
 */
export async function getPostBySlug(
  slug: string,
): Promise<PublishedPostView | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      contentMd: post.contentMd,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      ogImagePath: post.ogImagePath,
      ogImageGeneratedAt: post.ogImageGeneratedAt,
      tags: post.tags,
      wordCount: post.wordCount,
      readingTimeMin: post.readingTimeMin,
      needsReview: post.needsReview,
      publishedAt: post.publishedAt,
      lastReviewedAt: post.lastReviewedAt,
      authorSlug: author.slug,
      authorName: author.name,
      authorBioMd: author.bioMd,
      authorPhotoUrl: author.photoUrl,
      authorLinkedinUrl: author.linkedinUrl,
      categorySlug: category.slug,
      categoryName: category.name,
      categoryDescription: category.description,
    })
    .from(post)
    .leftJoin(author, eq(post.authorId, author.id))
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(and(eq(post.slug, slug), PUBLIC_DIRECT_FILTER))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    contentMd: r.contentMd,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    ogImagePath: r.ogImagePath,
    ogImageGeneratedAt: r.ogImageGeneratedAt,
    tags: r.tags ?? [],
    wordCount: r.wordCount,
    readingTimeMin: r.readingTimeMin,
    needsReview: r.needsReview,
    publishedAt: r.publishedAt ?? new Date(0),
    lastReviewedAt: r.lastReviewedAt,
    authorSlug: r.authorSlug,
    authorName: r.authorName,
    authorBioMd: r.authorBioMd,
    authorPhotoUrl: r.authorPhotoUrl,
    authorLinkedinUrl: r.authorLinkedinUrl,
    categorySlug: r.categorySlug,
    categoryName: r.categoryName,
    categoryDescription: r.categoryDescription,
  };
}

export interface ListPostsOptions {
  /** 1-based page number. */
  page?: number;
  /** Posts per page. Defaults to 10. */
  pageSize?: number;
  /** Filter to a specific category slug. */
  categorySlug?: string;
}

export interface ListPostsResult {
  posts: PublishedPostListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Paginated, listed-only post index. Backs /blog and /blog/category/[slug].
 * Ordered by published_at DESC. JOIN author + category for byline + eyebrow.
 */
export async function listPosts(
  opts: ListPostsOptions = {},
): Promise<ListPostsResult> {
  const db = getDb();
  const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 10));
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * pageSize;

  const filter = opts.categorySlug
    ? and(PUBLIC_LISTED_FILTER, eq(category.slug, opts.categorySlug))
    : PUBLIC_LISTED_FILTER;

  const rows = await db
    .select({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      ogImagePath: post.ogImagePath,
      readingTimeMin: post.readingTimeMin,
      publishedAt: post.publishedAt,
      lastReviewedAt: post.lastReviewedAt,
      categorySlug: category.slug,
      categoryName: category.name,
      authorSlug: author.slug,
      authorName: author.name,
    })
    .from(post)
    .leftJoin(author, eq(post.authorId, author.id))
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(filter)
    .orderBy(desc(post.publishedAt))
    .limit(pageSize)
    .offset(offset);

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(post)
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(filter);
  const totalCount = countRows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    posts: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      ogImagePath: r.ogImagePath,
      readingTimeMin: r.readingTimeMin,
      publishedAt: r.publishedAt ?? new Date(0),
      lastReviewedAt: r.lastReviewedAt,
      categorySlug: r.categorySlug,
      categoryName: r.categoryName,
      authorSlug: r.authorSlug,
      authorName: r.authorName,
    })),
    totalCount,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Read-next widget for the bottom of /blog/[slug]. HNSW ANN over the post
 * embedding column. Excludes the current post and falls back to the most
 * recent listed posts when ANN returns fewer than `limit` candidates (or
 * when the current post has no embedding).
 */
export async function getReadNext(
  currentPostId: string,
  limit = 3,
): Promise<ReadNextItem[]> {
  const db = getDb();

  // Pull the current post's embedding to use as the search vector.
  const currentRows = await db
    .select({ embedding: post.embedding })
    .from(post)
    .where(eq(post.id, currentPostId))
    .limit(1);

  const currentEmbedding = currentRows[0]?.embedding;
  if (!currentEmbedding) {
    return getRecentPosts(limit, currentPostId);
  }

  // Cosine distance ANN. HNSW index `post_embedding_hnsw_idx` (m=16,
  // ef_construction=64) serves this query. Sub-100ms for 253 rows.
  const embeddingLiteral = sql.raw(
    `'[${(currentEmbedding as unknown as number[]).join(",")}]'::vector`,
  );

  const rows = await db
    .select({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      readingTimeMin: post.readingTimeMin,
      categoryName: category.name,
    })
    .from(post)
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(and(ne(post.id, currentPostId), PUBLIC_LISTED_FILTER))
    .orderBy(sql`${post.embedding} <=> ${embeddingLiteral}`)
    .limit(limit);

  if (rows.length < limit) {
    // Pad with most-recent listed posts that aren't already in the list.
    const seen = new Set(rows.map((r) => r.id));
    seen.add(currentPostId);
    const extra = await db
      .select({
        id: post.id,
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        readingTimeMin: post.readingTimeMin,
        categoryName: category.name,
      })
      .from(post)
      .leftJoin(category, eq(post.categoryId, category.id))
      .where(PUBLIC_LISTED_FILTER)
      .orderBy(desc(post.publishedAt))
      .limit(limit * 2);
    for (const e of extra) {
      if (rows.length >= limit) break;
      if (seen.has(e.id)) continue;
      rows.push(e);
    }
  }

  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    categoryName: r.categoryName,
    readingTimeMin: r.readingTimeMin,
  }));
}

/**
 * Fallback used by getReadNext when ANN has no candidates, and by the
 * /blog index empty-state. Excludes the current post if provided.
 */
export async function getRecentPosts(
  limit = 3,
  excludeId?: string,
): Promise<ReadNextItem[]> {
  const db = getDb();
  const filter = excludeId
    ? and(ne(post.id, excludeId), PUBLIC_LISTED_FILTER)
    : PUBLIC_LISTED_FILTER;
  const rows = await db
    .select({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      readingTimeMin: post.readingTimeMin,
      categoryName: category.name,
    })
    .from(post)
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(filter)
    .orderBy(desc(post.publishedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    categoryName: r.categoryName,
    readingTimeMin: r.readingTimeMin,
  }));
}

export interface CategoryView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export async function getCategoryBySlug(
  slug: string,
): Promise<CategoryView | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
    })
    .from(category)
    .where(eq(category.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function listAllCategories(): Promise<CategoryView[]> {
  const db = getDb();
  return db
    .select({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
    })
    .from(category)
    .orderBy(category.name);
}

/**
 * Minimal projection for sitemap.xml and llms-full.txt. Listed-only —
 * unlisted posts stay out of sitemap-prominent surfaces.
 */
export interface PostSitemapEntry {
  slug: string;
  title: string;
  publishedAt: Date;
  lastReviewedAt: Date | null;
  excerpt: string | null;
  categoryName: string | null;
}

/**
 * Projection that ALSO carries content_md — for /llms-full.txt only.
 * Heavier query than listAllPostsForFeeds; keep behind the ISR cache.
 */
export async function listAllPostsForLlmsFull(): Promise<
  Array<PostSitemapEntry & { contentMd: string }>
> {
  const db = getDb();
  const rows = await db
    .select({
      slug: post.slug,
      title: post.title,
      publishedAt: post.publishedAt,
      lastReviewedAt: post.lastReviewedAt,
      excerpt: post.excerpt,
      categoryName: category.name,
      contentMd: post.contentMd,
    })
    .from(post)
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(PUBLIC_LISTED_FILTER)
    .orderBy(desc(post.publishedAt));
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    publishedAt: r.publishedAt ?? new Date(0),
    lastReviewedAt: r.lastReviewedAt,
    excerpt: r.excerpt,
    categoryName: r.categoryName,
    contentMd: r.contentMd,
  }));
}

export async function listAllPostsForFeeds(): Promise<PostSitemapEntry[]> {
  const db = getDb();
  const rows = await db
    .select({
      slug: post.slug,
      title: post.title,
      publishedAt: post.publishedAt,
      lastReviewedAt: post.lastReviewedAt,
      excerpt: post.excerpt,
      categoryName: category.name,
    })
    .from(post)
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(PUBLIC_LISTED_FILTER)
    .orderBy(desc(post.publishedAt));
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    publishedAt: r.publishedAt ?? new Date(0),
    lastReviewedAt: r.lastReviewedAt,
    excerpt: r.excerpt,
    categoryName: r.categoryName,
  }));
}
