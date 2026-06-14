import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { category, post } from "../db/schema";
import type { SearchByEmbeddingRow } from "./find-similar";

function escapeIlike(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}

export async function searchByText(
  query: string,
  limit = 10,
): Promise<(Omit<SearchByEmbeddingRow, "distance"> & { distance: null })[]> {
  const escaped = escapeIlike(query.trim());
  const pattern = `%${escaped}%`;
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
    })
    .from(post)
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(
      and(
        eq(post.status, "published"),
        eq(post.visibility, "listed"),
        isNull(post.archivedAt),
        sql`(${post.title} ILIKE ${pattern} OR ${post.excerpt} ILIKE ${pattern})`,
      ),
    )
    .orderBy(post.publishedAt)
    .limit(Math.max(1, Math.min(20, limit)));

  return rows.map((r) => ({ ...r, distance: null }));
}
