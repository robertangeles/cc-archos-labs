import "server-only";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { post } from "../db/schema";
import { embedPostContent } from "../embeddings";

// Stops the agent writing the same article twice.
//
// This does NOT use findSimilarPosts, and that is the whole point.
// `searchByEmbedding` hard-filters `status = 'published'`, but agent posts land
// as `scheduled` — so a guard built on it is blind to everything the agent has
// already written and not yet published. Observed in DEV: three posts, all
// "Three Questions That…" on the same subject, every one of them scheduled and
// therefore invisible to a published-only search.
//
// Runs before the workflow, so a duplicate costs an embedding call rather than
// a deep-research call plus a draft plus an illustration.

/**
 * Statuses that count as "we have already covered this".
 *
 * `scheduled` is the load-bearing half. Verified against the real database:
 * with this filter the nearest neighbour of a scheduled post IS that post
 * (distance 0.0000); with `status = 'published'` alone it is invisible.
 */
export const OCCUPIED = ["published", "scheduled"] as const;

export interface DuplicateMatch {
  id: string;
  slug: string;
  title: string;
  status: string;
  /** Cosine distance. 0 is identical; lower is more similar. */
  distance: number;
}

/**
 * The closest existing post to `title`, if it is closer than `threshold`.
 *
 * Returns null when nothing is close enough, when the embedder fails, or when
 * there is nothing to compare against. Failing open is deliberate: losing the
 * duplicate check costs a repeated topic, while failing closed would stop the
 * agent writing anything the moment the embedding API had a bad minute.
 */
export async function findDuplicateTopic(
  title: string,
  threshold: number,
): Promise<DuplicateMatch | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;

  let vector: number[];
  try {
    vector = await embedPostContent({ title: trimmed });
  } catch (err) {
    console.warn("[blog-agent] duplicate check skipped, embedding failed:", err);
    return null;
  }

  try {
    const literal = sql.raw(`'[${vector.join(",")}]'::vector`);
    const rows = await getDb()
      .select({
        id: post.id,
        slug: post.slug,
        title: post.title,
        status: post.status,
        distance: sql<number>`${post.embedding} <=> ${literal}`,
      })
      .from(post)
      .where(
        and(
          inArray(post.status, [...OCCUPIED]),
          isNull(post.archivedAt),
          sql`${post.embedding} IS NOT NULL`,
        ),
      )
      .orderBy(sql`${post.embedding} <=> ${literal}`)
      .limit(1);

    const nearest = rows[0];
    if (!nearest) return null;

    // parseFloat, not Number. postgres.js can hand numeric back as a string,
    // but `Number(null)` and `Number("")` are both 0 — finite, and below any
    // threshold — so a missing distance would read as "identical" and the
    // guard would skip every post it was ever asked about.
    const raw: unknown = nearest.distance;
    const distance =
      typeof raw === "number" ? raw : Number.parseFloat(String(raw));
    if (!Number.isFinite(distance) || distance >= threshold) return null;

    return { ...nearest, distance };
  } catch (err) {
    console.warn("[blog-agent] duplicate check skipped, query failed:", err);
    return null;
  }
}
