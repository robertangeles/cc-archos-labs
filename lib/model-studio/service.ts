import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { dataModel, project, client, users } from "../db/schema";
import type { ModelCreate, ModelUpdate, ModelListQuery } from "./validation";

// ============================================================================
// Model Studio service — data_model list/CRUD (LIST VIEW ONLY).
//
// Migrated from Spresso (packages/server/src/services/model-studio-model.service.ts)
// and ADAPTED to this codebase's org-context model. Spresso scoped access by
// "owned-by-user OR member-of-org"; here every model is reached only through
// its project, and a project is only reachable when project.organisation_id
// matches the caller's org (resolved upstream in lib/auth/org-context.ts). The
// service is therefore pure data access — no auth, no HTTP — exactly like
// lib/projects/service.ts: routes enforce access, this layer scopes queries.
//
// The hierarchy enrichment (projectName, clientName, ownerName) is hydrated in
// one SQL join rather than Spresso's per-list follow-up queries, avoiding N+1s.
//
// Each function takes an optional `dbArg` so tests can pass the pglite harness
// db; production calls fall through to the lazy singleton getDb().
// ============================================================================

/** Columns returned for every model, enriched with its place in the hierarchy.
 *  Shared by list/get/create/update so every path returns the same shape. */
const modelSelection = {
  id: dataModel.id,
  projectId: dataModel.projectId,
  ownerId: dataModel.ownerId,
  name: dataModel.name,
  description: dataModel.description,
  activeLayer: dataModel.activeLayer,
  notation: dataModel.notation,
  originDirection: dataModel.originDirection,
  metadata: dataModel.metadata,
  tags: dataModel.tags,
  lastExportedAt: dataModel.lastExportedAt,
  archivedAt: dataModel.archivedAt,
  createdAt: dataModel.createdAt,
  updatedAt: dataModel.updatedAt,
  // Provenance: where the model sits and who owns it.
  projectName: project.name,
  clientId: project.clientId,
  clientName: client.name,
  ownerName: users.displayName,
} as const;

/** Thrown when a create/update would collide with the unique
 *  (project, owner, name) index. Routes map this to HTTP 409. */
export class ModelConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConflictError";
  }
}

const PG_UNIQUE_VIOLATION = "23505";

/** True when `err` (or any error in its `cause` chain) is a Postgres unique
 *  violation. Drizzle wraps the driver error and carries the original pg error
 *  — with the SQLSTATE `code` — on `.cause`, so we walk the chain rather than
 *  reading `err.code` alone (which differs between postgres-js and pglite). */
export function isUniqueViolation(err: unknown): boolean {
  let cursor: unknown = err;
  for (let depth = 0; cursor && depth < 5; depth++) {
    if (
      typeof cursor === "object" &&
      "code" in cursor &&
      (cursor as { code?: string }).code === PG_UNIQUE_VIOLATION
    ) {
      return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Verify a project belongs to an org. Returns the project id when it does, or
 * null otherwise. The IDOR guard re-used by createModel so a model is never
 * inserted against a project outside the caller's org.
 */
async function projectInOrg(
  db: DB,
  orgId: string,
  projectId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organisationId, orgId)))
    .limit(1);
  return rows.length > 0 ? rows[0].id : null;
}

// ---- read ------------------------------------------------------------------

/**
 * List models in an org, newest-updated first. Joins through project so only
 * models whose project is in the org are ever returned. Optionally filters by
 * project and hides archived models; paged by limit/offset.
 */
export async function listModels(
  orgId: string,
  query: ModelListQuery,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();

  const filters = [eq(project.organisationId, orgId)];
  if (query.projectId) filters.push(eq(dataModel.projectId, query.projectId));
  if (!query.includeArchived) filters.push(isNull(dataModel.archivedAt));
  const where = and(...filters);

  const models = await db
    .select(modelSelection)
    .from(dataModel)
    .innerJoin(project, eq(dataModel.projectId, project.id))
    .leftJoin(client, eq(project.clientId, client.id))
    .innerJoin(users, eq(dataModel.ownerId, users.id))
    .where(where)
    .orderBy(desc(dataModel.updatedAt))
    .limit(query.limit)
    .offset(query.offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(dataModel)
    .innerJoin(project, eq(dataModel.projectId, project.id))
    .where(where);

  return { models, total };
}

/** Fetch one model, scoped to the org. Returns null if not found in the org. */
export async function getModel(orgId: string, modelId: string, dbArg?: DB) {
  const db = dbArg ?? getDb();
  const [row] = await db
    .select(modelSelection)
    .from(dataModel)
    .innerJoin(project, eq(dataModel.projectId, project.id))
    .leftJoin(client, eq(project.clientId, client.id))
    .innerJoin(users, eq(dataModel.ownerId, users.id))
    .where(and(eq(dataModel.id, modelId), eq(project.organisationId, orgId)))
    .limit(1);
  return row ?? null;
}

// ---- write -----------------------------------------------------------------

/**
 * Create a model in a project. Returns null if the project is not in the org
 * (so a caller can never plant a model in another org's project). Throws
 * ModelConflictError when (project, owner, name) already exists.
 */
export async function createModel(
  orgId: string,
  ownerId: string,
  input: ModelCreate,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await projectInOrg(db, orgId, input.projectId))) return null;

  try {
    const [row] = await db
      .insert(dataModel)
      .values({
        projectId: input.projectId,
        ownerId,
        name: input.name,
        description: input.description ?? null,
        activeLayer: input.activeLayer ?? "conceptual",
        notation: input.notation ?? "ie",
        originDirection: input.originDirection ?? "greenfield",
        metadata: input.metadata ?? {},
        tags: input.tags ?? [],
      })
      .returning({ id: dataModel.id });
    // Re-read through the join so the response carries the hierarchy fields.
    return getModel(orgId, row.id, db);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ModelConflictError(
        `A model named "${input.name}" already exists in this project for this owner.`,
      );
    }
    throw err;
  }
}

/** Update a model, scoped to the org. Returns null if not found in the org.
 *  Throws ModelConflictError when a rename collides with an existing model. */
export async function updateModel(
  orgId: string,
  modelId: string,
  patch: ModelUpdate,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  // Scope first: only update when the model's project is in the org. Without
  // this, an UPDATE keyed on id alone would reach across orgs.
  const existing = await getModel(orgId, modelId, db);
  if (!existing) return null;

  try {
    await db
      .update(dataModel)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description ?? null }
          : {}),
        ...(patch.activeLayer !== undefined
          ? { activeLayer: patch.activeLayer }
          : {}),
        ...(patch.notation !== undefined ? { notation: patch.notation } : {}),
        ...(patch.originDirection !== undefined
          ? { originDirection: patch.originDirection }
          : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.archivedAt !== undefined
          ? { archivedAt: patch.archivedAt ?? null }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(dataModel.id, modelId));
    // Re-read through the join so the response carries the hierarchy fields.
    return getModel(orgId, modelId, db);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ModelConflictError(
        `A model with that name already exists in this project for this owner.`,
      );
    }
    throw err;
  }
}

/** Delete a model, scoped to the org. Returns true if a row was removed.
 *  Canvas children cascade via the schema's ON DELETE FKs (added later). */
export async function deleteModel(
  orgId: string,
  modelId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  // Confirm the model is in the org before deleting (id-only delete would
  // otherwise reach across orgs).
  if (!(await getModel(orgId, modelId, db))) return false;

  const removed = await db
    .delete(dataModel)
    .where(eq(dataModel.id, modelId))
    .returning({ id: dataModel.id });
  return removed.length > 0;
}
