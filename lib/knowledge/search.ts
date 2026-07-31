import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { embedText } from "@/lib/embeddings";

export interface SearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  /** Author(s) as they should be cited. Null for a document ingested before
   *  migration 0039, or one genuinely without an author. */
  author: string | null;
  category: string | null;
  content: string;
  similarity: number;
}

export async function vectorSearch(
  query: string,
  category?: string,
  topK = 5,
): Promise<SearchResult[]> {
  const embedding = await embedText(query);
  const vectorStr = `[${embedding.join(",")}]`;
  const db = getDb();

  const categoryFilter = category
    ? sql`AND d.category = ${category}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT c.id AS chunk_id, c.document_id, c.content,
           d.title, d.author, d.category,
           1 - (c.embedding <=> ${vectorStr}::vector) AS similarity
    FROM knowledge_chunk c
    JOIN knowledge_document d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL
      AND d.status = 'ready'
      ${categoryFilter}
    ORDER BY c.embedding <=> ${vectorStr}::vector
    LIMIT ${topK}
  `);

  return (rows as unknown as Array<{
    chunk_id: string;
    document_id: string;
    content: string;
    title: string;
    author: string | null;
    category: string | null;
    similarity: number;
  }>).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: row.title,
    author: row.author,
    category: row.category,
    content: row.content,
    similarity: row.similarity,
  }));
}

export async function keywordSearch(
  query: string,
  category?: string,
  topK = 5,
): Promise<SearchResult[]> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (terms.length === 0) return [];

  const db = getDb();

  const conditions = terms.map(
    (term) =>
      sql`(LOWER(c.content) LIKE ${"%" + term + "%"} OR LOWER(d.title) LIKE ${"%" + term + "%"})`,
  );

  const scoreExpr = sql.join(
    terms.map(
      (term) =>
        sql`(CASE WHEN LOWER(d.title) LIKE ${"%" + term + "%"} THEN 10 ELSE 0 END +
             CASE WHEN LOWER(c.content) LIKE ${"%" + term + "%"} THEN 3 ELSE 0 END)`,
    ),
    sql` + `,
  );

  const categoryFilter = category
    ? sql`AND d.category = ${category}`
    : sql``;

  const anyMatch = sql.join(conditions, sql` OR `);

  const rows = await db.execute(sql`
    SELECT c.id AS chunk_id, c.document_id, c.content,
           d.title, d.author, d.category,
           (${scoreExpr}) AS similarity
    FROM knowledge_chunk c
    JOIN knowledge_document d ON d.id = c.document_id
    WHERE d.status = 'ready'
      AND (${anyMatch})
      ${categoryFilter}
    ORDER BY similarity DESC
    LIMIT ${topK}
  `);

  return (rows as unknown as Array<{
    chunk_id: string;
    document_id: string;
    content: string;
    title: string;
    author: string | null;
    category: string | null;
    similarity: number;
  }>)
    .filter((row) => row.similarity > 0)
    .map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      title: row.title,
      author: row.author,
      category: row.category,
      content: row.content,
      similarity: row.similarity,
    }));
}

export async function searchKnowledge(
  query: string,
  category?: string,
  topK = 5,
): Promise<SearchResult[]> {
  try {
    const results = await vectorSearch(query, category, topK);
    if (results.length > 0) return results;
  } catch {
    // vector search failed — fall through to keyword
  }

  return keywordSearch(query, category, topK);
}

// ── CDMP certification pool ────────────────────────────────────────────────
//
// Everything below is scoped by `is_cdmp_source`, NOT by category. Those are
// different questions and conflating them was a live production defect: until
// migration 0039 the exam generator selected material with
// `searchKnowledge(label, "dmbok", n)`, and 6 of PROD's 8 'dmbok'-tagged documents carried
// category='dmbok' while being wrong for a certification exam — The Trusted
// Advisor and The Pragmatic Programmer among them.
//
// A topic label answers "what is this book about". Exam eligibility answers
// "would a DAMA candidate consider a question from this fair". Keep them apart.

/**
 * Vector search restricted to documents explicitly approved as CDMP exam
 * sources. Same ANN path as vectorSearch — the HNSW index still drives the
 * ordering; the join predicate just narrows the candidate set.
 *
 * No keyword fallback on purpose: for exam generation, returning nothing is
 * correct and the caller already handles it (generate.ts logs SKIP and moves
 * on). Silently degrading to LIKE-matching would produce lower-quality
 * questions that look identical to good ones.
 */
export async function searchCdmpSources(
  query: string,
  topK = 5,
): Promise<SearchResult[]> {
  const embedding = await embedText(query);
  const vectorStr = `[${embedding.join(",")}]`;
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT c.id AS chunk_id, c.document_id, c.content,
           d.title, d.author, d.category,
           1 - (c.embedding <=> ${vectorStr}::vector) AS similarity
    FROM knowledge_chunk c
    JOIN knowledge_document d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL
      AND d.status = 'ready'
      AND d.is_cdmp_source = true
    ORDER BY c.embedding <=> ${vectorStr}::vector
    LIMIT ${topK}
  `);

  return (rows as unknown as Array<{
    chunk_id: string;
    document_id: string;
    content: string;
    title: string;
    author: string | null;
    category: string | null;
    similarity: number;
  }>).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: row.title,
    author: row.author,
    category: row.category,
    content: row.content,
    similarity: row.similarity,
  }));
}

// A chapter chunk carries its embedding so callers can rank by similarity in
// memory (CDMP specialist generation samples a seed chunk + nearest neighbours).
export interface ChapterChunk extends SearchResult {
  embedding: number[];
}

// Fetch EVERY embedded chunk for one DMBOK chapter (e.g. "Chapter 13") — a plain
// SQL scan, NOT a vector top-K. The `chapter` tag only exists on the DMBOK
// document, so this is implicitly scoped to it (the Kimball "Data Warehouse
// Toolkit" chunks are also is_cdmp_source but have chapter=NULL and are excluded).
// Filters `embedding IS NOT NULL` so a failed-embed chunk never enters the pool.
// Scoped by is_cdmp_source rather than category since migration 0039 — see the
// section header above for why those are not the same question.
export async function getChunksByChapter(chapter: string): Promise<ChapterChunk[]> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT c.id AS chunk_id, c.document_id, c.content,
           d.title, d.author, d.category, c.embedding::text AS embedding
    FROM knowledge_chunk c
    JOIN knowledge_document d ON d.id = c.document_id
    WHERE d.is_cdmp_source = true AND d.status = 'ready'
      AND c.chapter = ${chapter} AND c.embedding IS NOT NULL
  `);

  return (rows as unknown as Array<{
    chunk_id: string;
    document_id: string;
    content: string;
    title: string;
    author: string | null;
    category: string | null;
    embedding: string;
  }>).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: row.title,
    author: row.author,
    category: row.category,
    content: row.content,
    similarity: 0,
    embedding: JSON.parse(row.embedding) as number[],
  }));
}

// Count embedded DMBOK chunks per chapter in ONE query (no embeddings loaded).
// Used to size the specialist question-count caps in the UI.
export async function getChapterChunkCounts(): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT c.chapter AS chapter, COUNT(*)::int AS n
    FROM knowledge_chunk c
    JOIN knowledge_document d ON d.id = c.document_id
    WHERE d.is_cdmp_source = true AND d.status = 'ready'
      AND c.chapter IS NOT NULL AND c.embedding IS NOT NULL
    GROUP BY c.chapter
  `);
  const counts = new Map<string, number>();
  for (const r of rows as unknown as Array<{ chapter: string; n: number }>) {
    counts.set(r.chapter, r.n);
  }
  return counts;
}

/**
 * Library search for the search_library tool. Vector-only and deliberately
 * narrow: the tool is for checking ONE idea mid-answer, not for re-running the
 * turn's whole retrieval.
 *
 * Returns chunkId so the caller can drop anything the pre-turn retrieval
 * already showed the model.
 */
export async function searchLibraryChunks(
  query: string,
  topK = 4,
): Promise<SearchResult[]> {
  return vectorSearch(query, undefined, topK);
}
