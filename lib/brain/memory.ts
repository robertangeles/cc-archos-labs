import "server-only";
import { sql, eq, and, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { userMemory, workspaceMemory } from "@/lib/db/schema";
import { embedText } from "@/lib/embeddings";
import { extractFacts, consolidateAndApply } from "./distill";
import type { RecallResult } from "./recall";

// In-app pgvector memory backend: local Drizzle queries against the
// `user_memory` table. Every path here fails soft (returns empty / drops the
// write) — memory is best-effort enrichment and must never break chat.

// Recall tuning — mirrors the values proven in the CulinAIre brain.
const CANDIDATE_LIMIT = 30; // rows pulled by the cosine scan before re-rank
const TOP_K = 6; // memories injected after re-rank
const SIM_WEIGHT = 0.7; // cosine-similarity weight in the blend
const RECENCY_WEIGHT = 0.2; // recency weight in the blend
const RECENCY_HALFLIFE_DAYS = 30; // exp decay half-life for recency
const MAX_QUERY_CHARS = 2000; // query truncation before embedding

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
      WHERE user_id = ${userId}::uuid AND is_active AND embedding IS NOT NULL
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

/**
 * Recall the most relevant ORG-shared workspace facts for a query (the
 * workspace_memory tier). Mirrors recallFromDb but scoped by organisation_id
 * (the isolation boundary) and served by the HNSW ANN index. Returns ranked
 * bodies; [] on any failure. ponytail: embeds independently of recallFromDb —
 * a single shared embed is an optimization, not needed while both run
 * concurrently within the recall budget.
 */
export async function recallWorkspaceFromDb(
  orgId: string,
  query: string,
): Promise<string[]> {
  let embedding: number[];
  try {
    embedding = await embedText(query.slice(0, MAX_QUERY_CHARS));
  } catch {
    return [];
  }
  const vectorStr = `[${embedding.join(",")}]`;
  try {
    const rows = (await getDb().execute(sql`
      SELECT body, created_at,
             1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM workspace_memory
      WHERE organisation_id = ${orgId}::uuid AND is_active AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${CANDIDATE_LIMIT}
    `)) as unknown as Candidate[];
    if (rows.length === 0) return [];
    return rankMemories(rows, Date.now());
  } catch {
    return [];
  }
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
 * Capture a chat turn as clean atomic facts (distillation layer): extract
 * facts from the USER message, then consolidate (dedup / supersede) against
 * the user's existing facts. Fired fire-and-forget from the streaming path.
 * Stores nothing for greetings/questions or on any LLM failure. Never throws.
 */
export async function captureToDb(
  userId: string,
  userMessage: string,
  conversationId: string | null = null,
): Promise<void> {
  try {
    const facts = await extractFacts(userMessage);
    if (facts.length === 0) return;
    await consolidateAndApply(userId, facts, conversationId);
  } catch {
    // Best-effort; never surface to the chat path.
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
    .where(and(eq(userMemory.userId, userId), eq(userMemory.isActive, true)))
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

// ── Workspace tier (org-shared) management surface ──────────────────
//
// The Brain page reads BOTH tiers: a user's private chat memories (above) and
// the org-shared workspace facts ingested from projects/clients/cards. These
// are org-scoped, not user-scoped — the caller resolves the org first and is
// responsible for having validated membership (see resolveOrgContext).

export interface WorkspaceMemoryListItem {
  id: string;
  /** 'project' | 'client' | 'kanban_card' — drives the group header. */
  sourceType: string;
  sourceEntityId: string | null;
  /** The entity's display name, for the row's lead text. */
  entityName: string;
  content: string;
  updatedAt: string;
}

/**
 * List an org's live workspace memories, newest first.
 *
 * Scoped to orgId — the caller MUST pass an org the user is a member of
 * (resolveOrgContext re-validates membership on every call). Ordering is by
 * source_type then recency so the UI's grouped render is stable.
 */
export async function listWorkspaceMemoriesFromDb(
  orgId: string,
  limit = 200,
): Promise<WorkspaceMemoryListItem[]> {
  const rows = await getDb()
    .select({
      id: workspaceMemory.id,
      sourceType: workspaceMemory.sourceType,
      sourceEntityId: workspaceMemory.sourceEntityId,
      title: workspaceMemory.title,
      body: workspaceMemory.body,
      updatedAt: workspaceMemory.updatedAt,
    })
    .from(workspaceMemory)
    .where(
      and(
        eq(workspaceMemory.organisationId, orgId),
        eq(workspaceMemory.isActive, true),
      ),
    )
    .orderBy(workspaceMemory.sourceType, desc(workspaceMemory.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    sourceEntityId: r.sourceEntityId,
    entityName: entityNameFromFact(r.body, r.title),
    content: r.body,
    updatedAt: toIso(r.updatedAt),
  }));
}

/**
 * Soft-delete one workspace memory. Org-scoped: the id alone is not enough,
 * so a member of org A can never deactivate org B's row even with a valid id.
 * Soft, not hard — same supersede mechanism the ingest path uses, so the row
 * stays auditable and a re-ingest can supersede it cleanly.
 */
export async function deactivateWorkspaceMemory(
  orgId: string,
  id: string,
): Promise<boolean> {
  const updated = await getDb()
    .update(workspaceMemory)
    .set({ isActive: false, supersededAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workspaceMemory.id, id),
        eq(workspaceMemory.organisationId, orgId),
        eq(workspaceMemory.isActive, true),
      ),
    )
    .returning({ id: workspaceMemory.id });
  return updated.length > 0;
}

/**
 * Pull the entity's display name out of a fact body.
 *
 * Every ingested fact is written by an exported formatter that leads with the
 * entity name in double quotes — `Project "Acme"...`, `Client "Acme"...`,
 * `Card "Cutover"...` (see projectFact / clientFact / cardFact). Reading the
 * first quoted span back is cheaper than a polymorphic join across three
 * entity tables for what is purely a display label. Falls back to the stored
 * title, then the raw body, so a formatter change degrades to a worse label
 * rather than a blank row.
 */
function entityNameFromFact(body: string, title: string | null): string {
  const quoted = body.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  return title || body.slice(0, 80);
}

/** Lightweight status for the workspace Brain indicator. */
export async function getMemoryStatusFromDb(
  userId: string,
): Promise<{ hasMemory: boolean; lastActiveAt: string | null }> {
  const rows = await getDb()
    .select({ createdAt: userMemory.createdAt })
    .from(userMemory)
    .where(and(eq(userMemory.userId, userId), eq(userMemory.isActive, true)))
    .orderBy(desc(userMemory.createdAt))
    .limit(1);
  if (rows.length === 0) return { hasMemory: false, lastActiveAt: null };
  return { hasMemory: true, lastActiveAt: toIso(rows[0].createdAt) };
}

function toIso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
