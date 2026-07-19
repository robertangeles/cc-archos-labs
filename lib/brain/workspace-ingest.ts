import "server-only";
import pLimit from "p-limit";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { embedText } from "../embeddings";

// Phase 1 ingest: workspace entities → the org-scoped workspace_memory tier.
//
// Each entity contributes ONE canonical fact keyed by (source_type,
// source_entity_id). On (re-)ingest we supersede the entity's prior active
// fact and insert the new one — no LLM judge needed, because the entity key IS
// the identity (unlike chat's consolidateAndApply, which must guess which prior
// fact a new one relates to). Embed-only, deterministic, cheap.
//
// Feature-flagged (WORKSPACE_MEMORY_INGEST, per the per-org rollout decision)
// and bounded by a concurrency queue so a burst of concurrent entity writes
// (e.g. a team in sprint planning) can't fan out to unbounded embed calls.
// Fail-soft: an ingest failure NEVER propagates to the entity write path.
//
//   entity write ─▶ ingestEntity ─▶ [queue] ─▶ embed ─▶ tx{ supersede old; insert new }
//   entity delete ─▶ deactivateEntityMemory ─▶ soft-delete the entity's facts

const MAX_BODY_CHARS = 2000;
// Concurrency cap on the embed/DB pipeline. ponytail: fixed cap, make it a
// config knob only if real throughput data says 4 is wrong.
const queue = pLimit(4);

export function isWorkspaceMemoryEnabled(): boolean {
  return process.env.WORKSPACE_MEMORY_INGEST === "true";
}

export interface IngestInput {
  orgId: string;
  sourceType: string; // 'project' | 'client' | 'social_post' | 'skill' | ...
  sourceEntityId: string;
  body: string; // the canonical fact / entity text to remember
}

type EntityKey = Omit<IngestInput, "body">;

/**
 * Ingest (or re-ingest) one workspace entity's fact into the org-shared tier.
 * Supersedes the entity's prior active fact(s), then inserts the new one.
 * Meant to be called fire-and-forget from the entity write path — always
 * resolves, never throws. No-op when the feature flag is off.
 */
export async function ingestEntity(input: IngestInput): Promise<void> {
  if (!isWorkspaceMemoryEnabled()) return;
  const body = input.body?.trim();
  // Empty text (e.g. description cleared) → drop the entity's fact.
  if (!body) {
    await deactivateEntityMemory(input);
    return;
  }
  await queue(async () => {
    try {
      const emb = await embedText(body.slice(0, MAX_BODY_CHARS));
      const vec = `[${emb.join(",")}]`;
      const title = body.slice(0, 120);
      const db = getDb();
      await db.transaction(async (tx) => {
        // Supersede the entity's prior active fact(s) — handles updates.
        await tx.execute(supersedeSql(input));
        // Insert the fresh fact. ON CONFLICT guards the exact-dup case
        // (organisation_id, md5(body)) WHERE is_active.
        await tx.execute(sql`
          INSERT INTO workspace_memory
            (organisation_id, source_type, source_entity_id, title, body, embedding)
          VALUES
            (${input.orgId}::uuid, ${input.sourceType},
             ${input.sourceEntityId}::uuid, ${title}, ${body}, ${vec}::vector)
          ON CONFLICT (organisation_id, md5(body)) WHERE is_active DO NOTHING
        `);
      });
    } catch {
      /* best-effort; an ingest failure must never break the entity write */
    }
  });
}

/**
 * Soft-delete an entity's workspace facts (on entity delete or emptied text).
 * Fail-soft. No-op when the feature flag is off.
 */
export async function deactivateEntityMemory(input: EntityKey): Promise<void> {
  if (!isWorkspaceMemoryEnabled()) return;
  try {
    await getDb().execute(supersedeSql(input));
  } catch {
    /* best-effort */
  }
}

// Shared supersede predicate: deactivate an org's live facts for one entity.
function supersedeSql(input: EntityKey) {
  return sql`
    UPDATE workspace_memory
    SET is_active = false, superseded_at = now(), updated_at = now()
    WHERE organisation_id = ${input.orgId}::uuid
      AND source_type = ${input.sourceType}
      AND source_entity_id = ${input.sourceEntityId}::uuid
      AND is_active
  `;
}
