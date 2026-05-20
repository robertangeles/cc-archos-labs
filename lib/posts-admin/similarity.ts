import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { embedPostContent } from "../embeddings";
import { getDb } from "../db";
import { category, post } from "../db/schema";

// Similarity search backing the admin "Suggest internal links" button.
// Embeds the supplied draft content (Voyage/OpenRouter), then runs an
// ANN query against the existing post.embedding column for the top-N
// most-similar PUBLISHED posts.
//
// The HNSW index `post_embedding_hnsw_idx` (m=16, ef_construction=64)
// serves this query — sub-100ms at the current 253-post scale.
//
// Used by:
//   - /api/admin/posts/[id]/suggest-links (admin button)
//   - lib/posts.ts#getReadNext uses a similar pattern for the public
//     read-next widget; this module is admin-only and includes
//     unlisted posts in its candidate pool so the admin can link to
//     anything published.

export interface LinkSuggestion {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  categoryName: string | null;
  /** Cosine DISTANCE (0 = identical, 2 = opposite). Lower = more similar. */
  distance: number;
}

export interface SuggestLinksInput {
  /** Post id to exclude from results (the one being edited). */
  excludePostId: string;
  /** Draft text to embed and search against. */
  draftContent: {
    title: string;
    excerpt?: string | null;
    contentMd?: string | null;
  };
  /** How many suggestions to return. Defaults to 5. */
  limit?: number;
}

/**
 * Embed the draft and return the top-N most-similar published posts.
 * Only includes status='published' AND archived_at IS NULL — i.e. posts
 * the reader can actually click through to. Visibility is NOT filtered:
 * the admin can intentionally link to an unlisted post (campaign URL,
 * email-only piece, etc.).
 */
export async function suggestInternalLinks(
  input: SuggestLinksInput,
): Promise<LinkSuggestion[]> {
  const limit = Math.max(1, Math.min(20, input.limit ?? 5));

  const queryEmbedding = await embedPostContent(input.draftContent);

  // pgvector expects the literal in `'[1.0,2.0,...]'::vector` syntax.
  // sql.raw is safe here because every component of the literal is a
  // number from a trusted source (our own embedding call).
  const literal = sql.raw(`'[${queryEmbedding.join(",")}]'::vector`);

  const db = getDb();
  const rows = await db
    .select({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      categoryName: category.name,
      distance: sql<number>`${post.embedding} <=> ${literal}`,
    })
    .from(post)
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(
      and(
        ne(post.id, input.excludePostId),
        eq(post.status, "published"),
        sql`${post.archivedAt} IS NULL`,
        sql`${post.embedding} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${post.embedding} <=> ${literal}`)
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    categoryName: r.categoryName,
    // Drizzle returns numeric as string from postgres.js; coerce.
    distance: typeof r.distance === "number" ? r.distance : Number(r.distance),
  }));
}
