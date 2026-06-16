import "server-only";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { dataModel, dataModelAttribute, dataModelEntity, project } from "../db/schema";
import { ModelConflictError, isUniqueViolation } from "./service";
import type { Layer } from "./validation";
import type {
  EntityCreate,
  EntityUpdate,
  AttributeCreate,
  AttributeUpdate,
} from "./canvas-validation";

// ============================================================================
// Model Studio canvas service — entity / attribute / relationship /
// canvas-state data access (migrated from Spresso).
//
// Same contract as lib/model-studio/service.ts: pure data access, no auth, no
// HTTP. Routes resolve the caller's org (lib/auth/org-context.ts) and pass it
// in; this layer scopes every query through data_model → project →
// organisation_id so a caller can never reach another org's canvas. Each
// function takes an optional `dbArg` so tests inject the pglite harness db;
// production falls through to the lazy singleton getDb().
//
// Optimistic locking: updates carry the `version` the client last saw and run
// `UPDATE … WHERE id = $id AND version = $expected … SET version = version + 1`.
// Zero rows means either the row vanished (→ null/404) or the version moved
// under us (→ VersionConflictError, mapped to HTTP 409 by the route).
// ============================================================================

/** Thrown when an optimistic-locked update loses the race. Carries the current
 *  server version so the client can refresh and retry. Routes map to HTTP 409. */
export class VersionConflictError extends Error {
  constructor(public readonly serverVersion: number) {
    super("This record was changed since you loaded it. Refresh and try again.");
    this.name = "VersionConflictError";
  }
}

/**
 * Confirm a model belongs to an org. Returns the model id when it does, or null
 * otherwise. The IDOR guard for every canvas mutation — a model is only
 * reachable when its project's organisation_id matches the caller's org.
 */
async function modelInOrg(
  db: DB,
  orgId: string,
  modelId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: dataModel.id })
    .from(dataModel)
    .innerJoin(project, eq(dataModel.projectId, project.id))
    .where(and(eq(dataModel.id, modelId), eq(project.organisationId, orgId)))
    .limit(1);
  return rows.length > 0 ? rows[0].id : null;
}

// ---- entity ----------------------------------------------------------------

/** Columns returned for every entity. Shared by list/get/create/update so all
 *  paths return the same shape. */
const entitySelection = {
  id: dataModelEntity.id,
  dataModelId: dataModelEntity.dataModelId,
  name: dataModelEntity.name,
  businessName: dataModelEntity.businessName,
  description: dataModelEntity.description,
  entityType: dataModelEntity.entityType,
  layer: dataModelEntity.layer,
  displayId: dataModelEntity.displayId,
  altKeyLabels: dataModelEntity.altKeyLabels,
  metadata: dataModelEntity.metadata,
  tags: dataModelEntity.tags,
  version: dataModelEntity.version,
  createdBy: dataModelEntity.createdBy,
  createdAt: dataModelEntity.createdAt,
  updatedAt: dataModelEntity.updatedAt,
} as const;

/**
 * List a model's entities, ordered by display id (E001, E002, …). Optionally
 * filtered to one layer. Returns null when the model is not in the org (so the
 * route can 404) — distinct from an empty array (model exists, no entities).
 */
export async function listEntities(
  orgId: string,
  modelId: string,
  layer?: Layer,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await modelInOrg(db, orgId, modelId))) return null;

  const filters = [eq(dataModelEntity.dataModelId, modelId)];
  if (layer) filters.push(eq(dataModelEntity.layer, layer));

  return db
    .select(entitySelection)
    .from(dataModelEntity)
    .where(and(...filters))
    .orderBy(asc(dataModelEntity.displayId));
}

/** Fetch one entity, scoped to the org. Returns null if not found in the org. */
export async function getEntity(
  orgId: string,
  modelId: string,
  entityId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  const [row] = await db
    .select(entitySelection)
    .from(dataModelEntity)
    .innerJoin(dataModel, eq(dataModelEntity.dataModelId, dataModel.id))
    .innerJoin(project, eq(dataModel.projectId, project.id))
    .where(
      and(
        eq(dataModelEntity.id, entityId),
        eq(dataModelEntity.dataModelId, modelId),
        eq(project.organisationId, orgId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Create an entity in a model. Returns null if the model is not in the org.
 * The monotonic display id (E001, E002, …) is assigned inside a transaction —
 * `max(numeric suffix) + 1` — so concurrent creates can't read the same max;
 * the unique (data_model_id, display_id) index is the final backstop. Throws
 * ModelConflictError when (data_model_id, name) collides.
 */
export async function createEntity(
  orgId: string,
  modelId: string,
  createdBy: string,
  input: EntityCreate,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await modelInOrg(db, orgId, modelId))) return null;

  try {
    // Read max + insert in one transaction so the display id is consistent;
    // the unique (data_model_id, display_id) index is the final race backstop.
    return await db.transaction(async (tx) => {
      const [{ maxNum }] = await tx
        .select({
          // Strip the leading 'E', cast the rest to int, take the max (0 if none).
          maxNum: sql<number>`coalesce(max(cast(substring(${dataModelEntity.displayId} from 2) as integer)), 0)`,
        })
        .from(dataModelEntity)
        .where(eq(dataModelEntity.dataModelId, modelId));

      const displayId = `E${String(Number(maxNum) + 1).padStart(3, "0")}`;

      const [row] = await tx
        .insert(dataModelEntity)
        .values({
          dataModelId: modelId,
          createdBy,
          name: input.name,
          businessName: input.businessName ?? null,
          description: input.description ?? null,
          entityType: input.entityType ?? "standard",
          layer: input.layer,
          displayId,
          altKeyLabels: input.altKeyLabels ?? {},
          metadata: input.metadata ?? {},
          tags: input.tags ?? [],
        })
        .returning(entitySelection);
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ModelConflictError(
        `An entity named "${input.name}" already exists in this model.`,
      );
    }
    throw err;
  }
}

/**
 * Update an entity, scoped to the org and version-locked. Returns null if not
 * found in the org; throws VersionConflictError when the version moved under us
 * and ModelConflictError when a rename collides.
 */
export async function updateEntity(
  orgId: string,
  modelId: string,
  entityId: string,
  patch: EntityUpdate,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  // Scope first: confirm the entity is in the org (id-only update would reach
  // across orgs).
  if (!(await getEntity(orgId, modelId, entityId, db))) return null;

  try {
    const updated = await db
      .update(dataModelEntity)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.businessName !== undefined
          ? { businessName: patch.businessName ?? null }
          : {}),
        ...(patch.description !== undefined
          ? { description: patch.description ?? null }
          : {}),
        ...(patch.entityType !== undefined
          ? { entityType: patch.entityType }
          : {}),
        ...(patch.layer !== undefined ? { layer: patch.layer } : {}),
        ...(patch.altKeyLabels !== undefined
          ? { altKeyLabels: patch.altKeyLabels }
          : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        version: sql`${dataModelEntity.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(dataModelEntity.id, entityId),
          eq(dataModelEntity.version, patch.version),
        ),
      )
      .returning({ id: dataModelEntity.id });

    if (updated.length === 0) {
      // In-org (checked above) but no row matched the version → stale write.
      const current = await getEntity(orgId, modelId, entityId, db);
      if (!current) return null; // deleted concurrently
      throw new VersionConflictError(current.version);
    }
    return getEntity(orgId, modelId, entityId, db);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ModelConflictError(
        `An entity with that name already exists in this model.`,
      );
    }
    throw err;
  }
}

/** Delete an entity, scoped to the org. Returns true if a row was removed.
 *  Attributes and relationships cascade via the schema's ON DELETE FKs. */
export async function deleteEntity(
  orgId: string,
  modelId: string,
  entityId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  if (!(await getEntity(orgId, modelId, entityId, db))) return false;

  const removed = await db
    .delete(dataModelEntity)
    .where(eq(dataModelEntity.id, entityId))
    .returning({ id: dataModelEntity.id });
  return removed.length > 0;
}

// ---- attribute -------------------------------------------------------------

/** Columns returned for every attribute. */
const attributeSelection = {
  id: dataModelAttribute.id,
  dataModelId: dataModelAttribute.dataModelId,
  entityId: dataModelAttribute.entityId,
  name: dataModelAttribute.name,
  dataType: dataModelAttribute.dataType,
  dataTypeParams: dataModelAttribute.dataTypeParams,
  ordinalPosition: dataModelAttribute.ordinalPosition,
  isPrimaryKey: dataModelAttribute.isPrimaryKey,
  isNullable: dataModelAttribute.isNullable,
  isUnique: dataModelAttribute.isUnique,
  isForeignKey: dataModelAttribute.isForeignKey,
  classification: dataModelAttribute.classification,
  altKeyGroup: dataModelAttribute.altKeyGroup,
  defaultValue: dataModelAttribute.defaultValue,
  description: dataModelAttribute.description,
  metadata: dataModelAttribute.metadata,
  version: dataModelAttribute.version,
  createdBy: dataModelAttribute.createdBy,
  createdAt: dataModelAttribute.createdAt,
  updatedAt: dataModelAttribute.updatedAt,
} as const;

/** Fetch one attribute, scoped to the org through entity → model → project. */
async function getAttribute(
  orgId: string,
  modelId: string,
  entityId: string,
  attributeId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  const [row] = await db
    .select(attributeSelection)
    .from(dataModelAttribute)
    .innerJoin(dataModelEntity, eq(dataModelAttribute.entityId, dataModelEntity.id))
    .innerJoin(dataModel, eq(dataModelEntity.dataModelId, dataModel.id))
    .innerJoin(project, eq(dataModel.projectId, project.id))
    .where(
      and(
        eq(dataModelAttribute.id, attributeId),
        eq(dataModelAttribute.entityId, entityId),
        eq(dataModelEntity.dataModelId, modelId),
        eq(project.organisationId, orgId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** List an entity's attributes by ordinal position. Returns null when the
 *  entity is not in the org (route → 404). */
export async function listAttributes(
  orgId: string,
  modelId: string,
  entityId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await getEntity(orgId, modelId, entityId, db))) return null;
  return db
    .select(attributeSelection)
    .from(dataModelAttribute)
    .where(eq(dataModelAttribute.entityId, entityId))
    .orderBy(asc(dataModelAttribute.ordinalPosition));
}

/** Batch-load every attribute in a model, ordered by entity then ordinal —
 *  the canvas preload. Returns null when the model is not in the org. */
export async function listModelAttributes(
  orgId: string,
  modelId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await modelInOrg(db, orgId, modelId))) return null;
  return db
    .select(attributeSelection)
    .from(dataModelAttribute)
    .where(eq(dataModelAttribute.dataModelId, modelId))
    .orderBy(
      asc(dataModelAttribute.entityId),
      asc(dataModelAttribute.ordinalPosition),
    );
}

/**
 * Create an attribute on an entity. Returns null if the entity is not in the
 * org. Ordinal position is appended (max + 1) inside a transaction. Throws
 * ModelConflictError on a duplicate (entity, name).
 */
export async function createAttribute(
  orgId: string,
  modelId: string,
  entityId: string,
  createdBy: string,
  input: AttributeCreate,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await getEntity(orgId, modelId, entityId, db))) return null;

  try {
    return await db.transaction(async (tx) => {
      const [{ maxOrd }] = await tx
        .select({
          maxOrd: sql<number>`coalesce(max(${dataModelAttribute.ordinalPosition}), 0)`,
        })
        .from(dataModelAttribute)
        .where(eq(dataModelAttribute.entityId, entityId));

      const [row] = await tx
        .insert(dataModelAttribute)
        .values({
          dataModelId: modelId,
          entityId,
          createdBy,
          name: input.name,
          dataType: input.dataType ?? null,
          dataTypeParams: input.dataTypeParams ?? null,
          ordinalPosition: Number(maxOrd) + 1,
          isPrimaryKey: input.isPrimaryKey ?? false,
          isNullable: input.isNullable ?? true,
          isUnique: input.isUnique ?? false,
          isForeignKey: input.isForeignKey ?? false,
          classification: input.classification ?? null,
          altKeyGroup: input.altKeyGroup ?? null,
          defaultValue: input.defaultValue ?? null,
          description: input.description ?? null,
          metadata: input.metadata ?? {},
        })
        .returning(attributeSelection);
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ModelConflictError(
        `An attribute named "${input.name}" already exists on this entity.`,
      );
    }
    throw err;
  }
}

/** Update an attribute, scoped + version-locked. Null if not in org; throws
 *  VersionConflictError on a stale write, ModelConflictError on a rename clash. */
export async function updateAttribute(
  orgId: string,
  modelId: string,
  entityId: string,
  attributeId: string,
  patch: AttributeUpdate,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await getAttribute(orgId, modelId, entityId, attributeId, db))) return null;

  try {
    const updated = await db
      .update(dataModelAttribute)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.dataType !== undefined
          ? { dataType: patch.dataType ?? null }
          : {}),
        ...(patch.dataTypeParams !== undefined
          ? { dataTypeParams: patch.dataTypeParams ?? null }
          : {}),
        ...(patch.isPrimaryKey !== undefined
          ? { isPrimaryKey: patch.isPrimaryKey }
          : {}),
        ...(patch.isNullable !== undefined
          ? { isNullable: patch.isNullable }
          : {}),
        ...(patch.isUnique !== undefined ? { isUnique: patch.isUnique } : {}),
        ...(patch.isForeignKey !== undefined
          ? { isForeignKey: patch.isForeignKey }
          : {}),
        ...(patch.classification !== undefined
          ? { classification: patch.classification ?? null }
          : {}),
        ...(patch.altKeyGroup !== undefined
          ? { altKeyGroup: patch.altKeyGroup ?? null }
          : {}),
        ...(patch.defaultValue !== undefined
          ? { defaultValue: patch.defaultValue ?? null }
          : {}),
        ...(patch.description !== undefined
          ? { description: patch.description ?? null }
          : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        version: sql`${dataModelAttribute.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(dataModelAttribute.id, attributeId),
          eq(dataModelAttribute.version, patch.version),
        ),
      )
      .returning({ id: dataModelAttribute.id });

    if (updated.length === 0) {
      const current = await getAttribute(orgId, modelId, entityId, attributeId, db);
      if (!current) return null;
      throw new VersionConflictError(current.version);
    }
    return getAttribute(orgId, modelId, entityId, attributeId, db);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ModelConflictError(
        `An attribute with that name already exists on this entity.`,
      );
    }
    throw err;
  }
}

/** Delete an attribute, scoped to the org. Returns true if a row was removed. */
export async function deleteAttribute(
  orgId: string,
  modelId: string,
  entityId: string,
  attributeId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  if (!(await getAttribute(orgId, modelId, entityId, attributeId, db))) {
    return false;
  }
  const removed = await db
    .delete(dataModelAttribute)
    .where(eq(dataModelAttribute.id, attributeId))
    .returning({ id: dataModelAttribute.id });
  return removed.length > 0;
}

/**
 * Move an attribute up or down by swapping ordinal_position with its adjacent
 * sibling, atomically. Version-locked on the moving attribute. Returns null if
 * not in org; the unchanged attribute if it is already at the edge; throws
 * VersionConflictError on a stale version.
 */
export async function reorderAttribute(
  orgId: string,
  modelId: string,
  entityId: string,
  attributeId: string,
  direction: "up" | "down",
  expectedVersion: number,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  const current = await getAttribute(orgId, modelId, entityId, attributeId, db);
  if (!current) return null;
  if (current.version !== expectedVersion) {
    throw new VersionConflictError(current.version);
  }

  await db.transaction(async (tx) => {
    const [sibling] = await tx
      .select({
        id: dataModelAttribute.id,
        ordinalPosition: dataModelAttribute.ordinalPosition,
      })
      .from(dataModelAttribute)
      .where(
        and(
          eq(dataModelAttribute.entityId, entityId),
          direction === "up"
            ? lt(dataModelAttribute.ordinalPosition, current.ordinalPosition)
            : gt(dataModelAttribute.ordinalPosition, current.ordinalPosition),
        ),
      )
      .orderBy(
        direction === "up"
          ? desc(dataModelAttribute.ordinalPosition)
          : asc(dataModelAttribute.ordinalPosition),
      )
      .limit(1);

    if (!sibling) return; // already at the edge — no-op

    // Swap the two ordinals, bumping both versions so a later edit of either
    // row that still holds the old version is rejected.
    await tx
      .update(dataModelAttribute)
      .set({
        ordinalPosition: sibling.ordinalPosition,
        version: sql`${dataModelAttribute.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(dataModelAttribute.id, current.id));
    await tx
      .update(dataModelAttribute)
      .set({
        ordinalPosition: current.ordinalPosition,
        version: sql`${dataModelAttribute.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(dataModelAttribute.id, sibling.id));
  });

  return getAttribute(orgId, modelId, entityId, attributeId, db);
}
