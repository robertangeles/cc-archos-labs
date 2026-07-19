import "server-only";
import { sql, eq, and, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { userMemory } from "@/lib/db/schema";
import { embedText } from "@/lib/embeddings";
import { sanitizeForBrain } from "./sanitize";
import type { RecallResult } from "./recall";

// In-app pgvector memory backend. Replaces the external GBrain MCP calls
// with local Drizzle queries against the `user_memory` table. Selected when
// MEMORY_BACKEND=pgvector. Every path here fails soft (returns empty / drops
// the write) — memory is best-effort enrichment and must never break chat.

/**
 * Which memory backend is active. Env-var cutover flag, mirroring the
 * existing transitional `INTEGRATION_FALLBACK_ENABLED` pattern
 * (lib/integration-config.ts). Defaults to the legacy GBrain path so an
 * unset env changes nothing. Removed once GBrain is decommissioned.
 */
export function memoryBackend(): "pgvector" | "gbrain" {
  return process.env.MEMORY_BACKEND === "pgvector" ? "pgvector" : "gbrain";
}

// Recall tuning — mirrors the values proven in the CulinAIre brain.
const CANDIDATE_LIMIT = 30; // rows pulled by the cosine scan before re-rank
const TOP_K = 6; // memories injected after re-rank
const SIM_WEIGHT = 0.7; // cosine-similarity weight in the blend
const RECENCY_WEIGHT = 0.2; // recency weight in the blend
const RECENCY_HALFLIFE_DAYS = 30; // exp decay half-life for recency
const MAX_QUERY_CHARS = 2000; // query truncation before embedding
const MAX_BODY_CHARS = 8000; // stored-body cap (embed input limit)
const MIN_BODY_CHARS = 8; // below this, nothing worth storing

const EMPTY: RecallResult = { memories: [], source: "none", count: 0 };

/**
 * Recall the most relevant memories for a query. Embeds the query, runs an
 * exact cosine scan over this user's slice, re-ranks by a similarity+recency
 * blend, and returns the top few bodies. Returns EMPTY on any failure —
 * embed API down, DB error, or no memories — never throws.
 */
export async function recallFromDb(
  userId: string,
  query: string,
): Promise<RecallResult> {
  let embedding: number[];
  try {
    embedding = await embedText(query.slice(0, MAX_QUERY_CHARS));
  } catch {
    return EMPTY; // embed API down → ungrounded, not an error
  }

  const vectorStr = `[${embedding.join(",")}]`;
  const db = getDb();

  let rows: Array<{ body: string; created_at: string | Date; similarity: number }>;
  try {
    // Exact cosine scan, scoped to this user only (tenant isolation lives in
    // the WHERE clause). No ANN index by design — see the table comment.
    rows = (await db.execute(sql`
      SELECT body, created_at,
             1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM user_memory
      WHERE user_id = ${userId}::uuid AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${CANDIDATE_LIMIT}
    `)) as unknown as Array<{
      body: string;
      created_at: string | Date;
      similarity: number;
    }>;
  } catch {
    return EMPTY;
  }

  if (rows.length === 0) return EMPTY;

  const ranked = rankMemories(rows, Date.now());
  return { memories: ranked, source: "brain", count: ranked.length };
}

export interface Candidate {
  body: string;
  created_at: string | Date;
  similarity: number;
}

/**
 * Re-rank cosine candidates by a similarity+recency blend and return the
 * top few bodies. Pure and deterministic (time is injected) so it can be
 * unit-tested without a DB or embeddings.
 *
 *   rank = 0.7·similarity + 0.2·exp(-ageDays / 30)
 */
export function rankMemories(
  rows: Candidate[],
  now: number,
  topK: number = TOP_K,
): string[] {
  return rows
    .map((r) => {
      const ageDays = Math.max(
        0,
        (now - new Date(r.created_at).getTime()) / 86_400_000,
      );
      const rank =
        SIM_WEIGHT * Number(r.similarity) +
        RECENCY_WEIGHT * Math.exp(-ageDays / RECENCY_HALFLIFE_DAYS);
      return { body: r.body, rank };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, topK)
    .map((r) => r.body);
}

/**
 * Capture one chat turn as a memory: sanitize both sides, embed, insert.
 * Fired fire-and-forget from the streaming path, so a slow embed never
 * blocks the reply. Drops the turn on embed/DB failure (best-effort — the
 * next turn re-captures overlapping context). Never throws.
 */
export async function captureToDb(
  userId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  const user = sanitizeForBrain(userMessage);
  const assistant = sanitizeForBrain(assistantResponse);
  const body = `## User\n${user.sanitized}\n\n## Assistant\n${assistant.sanitized}`.trim();
  if (body.length < MIN_BODY_CHARS) return; // nothing worth storing

  const title = user.sanitized.trim().slice(0, 120) || null;

  let embedding: number[];
  try {
    embedding = await embedText(body.slice(0, MAX_BODY_CHARS));
  } catch {
    return; // embed API down → drop this turn (self-heals next turn)
  }

  try {
    await getDb().insert(userMemory).values({
      userId,
      sourceType: "chat",
      title,
      body,
      embedding,
    });
  } catch {
    // Insert failed — best-effort; never surface to the chat path.
  }
}

// ── Management surface (Brain page, account deletion, status) ────────

export interface MemoryListItem {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

/** List a user's memories, newest first. Scoped to userId. */
export async function listMemoriesFromDb(
  userId: string,
  limit = 50,
): Promise<MemoryListItem[]> {
  const rows = await getDb()
    .select({
      id: userMemory.id,
      title: userMemory.title,
      body: userMemory.body,
      updatedAt: userMemory.updatedAt,
    })
    .from(userMemory)
    .where(eq(userMemory.userId, userId))
    .orderBy(desc(userMemory.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    title: r.title || "Memory",
    content: r.body,
    updatedAt: toIso(r.updatedAt),
  }));
}

/** Delete one memory, but only if it belongs to userId (authz guard). */
export async function deleteMemoryFromDb(
  userId: string,
  id: string,
): Promise<boolean> {
  const deleted = await getDb()
    .delete(userMemory)
    .where(and(eq(userMemory.id, id), eq(userMemory.userId, userId)))
    .returning({ id: userMemory.id });
  return deleted.length > 0;
}

/** Delete every memory for a user (account cleanup). Returns the count. */
export async function deleteAllMemoriesFromDb(userId: string): Promise<number> {
  const deleted = await getDb()
    .delete(userMemory)
    .where(eq(userMemory.userId, userId))
    .returning({ id: userMemory.id });
  return deleted.length;
}

/** Lightweight status for the workspace Brain indicator. */
export async function getMemoryStatusFromDb(
  userId: string,
): Promise<{ hasMemory: boolean; lastActiveAt: string | null }> {
  const rows = await getDb()
    .select({ createdAt: userMemory.createdAt })
    .from(userMemory)
    .where(eq(userMemory.userId, userId))
    .orderBy(desc(userMemory.createdAt))
    .limit(1);
  if (rows.length === 0) return { hasMemory: false, lastActiveAt: null };
  return { hasMemory: true, lastActiveAt: toIso(rows[0].createdAt) };
}

function toIso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
