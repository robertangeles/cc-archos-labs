import { z } from "zod";
import { LAYER, NOTATION, uuidParam, metadataSchema, tagsSchema } from "./validation";

// ============================================================================
// Model Studio canvas validation — Zod schemas for the entity / attribute /
// relationship / canvas-state CRUD paths.
//
// Migrated from Spresso (packages/shared/src/utils/model-studio.schemas.ts).
// The list-view schemas live in ./validation.ts; this file covers the canvas
// layer only. Enum values stay in lockstep with the varchar columns on the
// data_model_entity / _attribute / _relationship / _canvas_state tables in
// lib/db/schema.ts. Bounds mirror the column limits so a value that passes
// validation always fits its column.
//
// Optimistic locking: every *update* schema requires the `version` the client
// last saw. The service compares it to the row and 409s on a mismatch, so a
// PATCH that omits `version` is rejected here before it reaches the service.
// ============================================================================

// ---- enums -----------------------------------------------------------------

/** Structural kind of an entity box on the canvas. */
export const ENTITY_TYPE = z.enum([
  "standard",
  "associative",
  "subtype",
  "supertype",
]);
export type EntityType = z.infer<typeof ENTITY_TYPE>;

/** Relationship cardinality at each end (semantic names, not crow's-foot
 *  glyphs — the canvas maps these to IE/IDEF1X symbols at render time). */
export const CARDINALITY = z.enum([
  "one",
  "many",
  "zero_or_one",
  "zero_or_many",
  "one_or_many",
]);
export type Cardinality = z.infer<typeof CARDINALITY>;

/** Governance/sensitivity classification (DMBOK + compliance categories).
 *  Nullable on the column — null means "no classification set". */
export const ATTRIBUTE_CLASSIFICATION = z.enum([
  "PII",
  "PCI",
  "PHI",
  "Financial",
  "Confidential",
  "Restricted",
  "Internal",
  "Public",
]);
export type AttributeClassification = z.infer<typeof ATTRIBUTE_CLASSIFICATION>;

// ---- helpers ---------------------------------------------------------------

const trimmedNonEmpty = (min: number, max: number, field: string) =>
  z
    .string()
    .trim()
    .min(min, `${field} must not be empty`)
    .max(max, `${field} must be ${max} characters or fewer`);

/** Alternate-key group label: `AKn` where n is one or more digits. Matches
 *  the Spresso server-side normaliser exactly so rejected input is consistent. */
const altKeyGroupSchema = z
  .string()
  .regex(/^AK\d+$/, "Alt-key group must look like AK1, AK2, …");

/** Per-alt-key-group display labels, e.g. { "AK1": "NI number" }. Keys are
 *  AK-group labels; values are short human strings. */
const altKeyLabelsSchema = z
  .record(altKeyGroupSchema, z.string().trim().max(100))
  .default({});

/** Open-ended type parameters, e.g. { precision: 18, scale: 2 } for
 *  numeric(18,2). Validated shallowly — the canvas owns the shape. */
const dataTypeParamsSchema = z.record(z.string(), z.unknown());

/** The version the client last saw — the optimistic-lock token on updates. */
const versionSchema = z.number().int().positive();

// Update bodies must NOT inject defaults: a version-only PATCH would otherwise
// parse to { version, metadata:{}, tags:[], altKeyLabels:{} } and slip past the
// "at least one mutable field" guard. Create schemas keep the defaulting
// variants (metadataSchema / tagsSchema / altKeyLabelsSchema); updates use these.
const metadataOptional = z.record(z.string(), z.unknown()).optional();
const tagsOptional = z
  .array(z.string().trim().min(1).max(50))
  .max(30, "Too many tags")
  .optional();
const altKeyLabelsOptional = z
  .record(altKeyGroupSchema, z.string().trim().max(100))
  .optional();

/** Reject an update body that carries only `version` and no actual change. */
const atLeastOneMutableField = (v: Record<string, unknown>) =>
  Object.keys(v).filter((k) => k !== "version").length > 0;

// ---- entity ----------------------------------------------------------------

export const entityCreateSchema = z.object({
  name: trimmedNonEmpty(1, 128, "Name"),
  businessName: z.string().trim().max(255).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  entityType: ENTITY_TYPE.optional().default("standard"),
  layer: LAYER,
  altKeyLabels: altKeyLabelsSchema.optional(),
  metadata: metadataSchema.optional(),
  tags: tagsSchema.optional(),
  // displayId is server-assigned (monotonic per model); never client input.
});
export type EntityCreate = z.infer<typeof entityCreateSchema>;

export const entityUpdateSchema = z
  .object({
    name: trimmedNonEmpty(1, 128, "Name").optional(),
    businessName: z.string().trim().max(255).nullable().optional(),
    description: z.string().max(10_000).nullable().optional(),
    entityType: ENTITY_TYPE.optional(),
    layer: LAYER.optional(),
    altKeyLabels: altKeyLabelsOptional,
    metadata: metadataOptional,
    tags: tagsOptional,
    version: versionSchema,
  })
  .refine(atLeastOneMutableField, {
    message: "At least one field besides version must be provided",
  });
export type EntityUpdate = z.infer<typeof entityUpdateSchema>;

// ---- attribute -------------------------------------------------------------

export const attributeCreateSchema = z.object({
  name: trimmedNonEmpty(1, 128, "Name"),
  dataType: z.string().trim().max(100).nullable().optional(),
  dataTypeParams: dataTypeParamsSchema.nullable().optional(),
  isPrimaryKey: z.boolean().optional().default(false),
  isNullable: z.boolean().optional().default(true),
  isUnique: z.boolean().optional().default(false),
  isForeignKey: z.boolean().optional().default(false),
  classification: ATTRIBUTE_CLASSIFICATION.nullable().optional(),
  altKeyGroup: altKeyGroupSchema.nullable().optional(),
  defaultValue: z.string().max(10_000).nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  metadata: metadataSchema.optional(),
  // ordinalPosition is server-assigned (appended); never client input.
});
export type AttributeCreate = z.infer<typeof attributeCreateSchema>;

export const attributeUpdateSchema = z
  .object({
    name: trimmedNonEmpty(1, 128, "Name").optional(),
    dataType: z.string().trim().max(100).nullable().optional(),
    dataTypeParams: dataTypeParamsSchema.nullable().optional(),
    isPrimaryKey: z.boolean().optional(),
    isNullable: z.boolean().optional(),
    isUnique: z.boolean().optional(),
    isForeignKey: z.boolean().optional(),
    classification: ATTRIBUTE_CLASSIFICATION.nullable().optional(),
    altKeyGroup: altKeyGroupSchema.nullable().optional(),
    defaultValue: z.string().max(10_000).nullable().optional(),
    description: z.string().max(10_000).nullable().optional(),
    metadata: metadataOptional,
    version: versionSchema,
  })
  .refine(atLeastOneMutableField, {
    message: "At least one field besides version must be provided",
  });
export type AttributeUpdate = z.infer<typeof attributeUpdateSchema>;

/** Reorder is folded into the attribute PATCH route via this discriminated
 *  body so it needs no separate endpoint. The service swaps ordinal_position
 *  with the adjacent sibling in a transaction. */
export const attributeReorderSchema = z
  .object({
    action: z.literal("reorder"),
    direction: z.enum(["up", "down"]),
    version: versionSchema,
  })
  .strict();
export type AttributeReorder = z.infer<typeof attributeReorderSchema>;

// ---- relationship ----------------------------------------------------------

/** User-authored edge routing waypoints. */
const waypointsSchema = z.array(z.object({ x: z.number(), y: z.number() }));

export const relationshipCreateSchema = z.object({
  sourceEntityId: uuidParam,
  targetEntityId: uuidParam,
  name: z.string().trim().max(128).nullable().optional(),
  nameInverse: z.string().trim().max(128).nullable().optional(),
  sourceCardinality: CARDINALITY,
  targetCardinality: CARDINALITY,
  isIdentifying: z.boolean().optional().default(false),
  isNullableForeignKey: z.boolean().optional().default(false),
  description: z.string().max(10_000).nullable().optional(),
  metadata: metadataSchema.optional(),
  waypoints: waypointsSchema.nullable().optional(),
});
export type RelationshipCreate = z.infer<typeof relationshipCreateSchema>;

export const relationshipUpdateSchema = z
  .object({
    name: z.string().trim().max(128).nullable().optional(),
    nameInverse: z.string().trim().max(128).nullable().optional(),
    sourceCardinality: CARDINALITY.optional(),
    targetCardinality: CARDINALITY.optional(),
    isIdentifying: z.boolean().optional(),
    isNullableForeignKey: z.boolean().optional(),
    description: z.string().max(10_000).nullable().optional(),
    metadata: metadataOptional,
    waypoints: waypointsSchema.nullable().optional(),
    version: versionSchema,
  })
  .refine(atLeastOneMutableField, {
    message: "At least one field besides version must be provided",
  });
export type RelationshipUpdate = z.infer<typeof relationshipUpdateSchema>;

// ---- canvas state ----------------------------------------------------------

/** React Flow viewport (pan + zoom). */
const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

/** Node positions keyed by entity id: { [entityId]: { x, y } }. */
const nodePositionsSchema = z.record(
  z.string(),
  z.object({ x: z.number(), y: z.number() }),
);

export const canvasStatePutSchema = z.object({
  layer: LAYER,
  nodePositions: nodePositionsSchema,
  viewport: viewportSchema,
  notation: NOTATION.optional(),
});
export type CanvasStatePut = z.infer<typeof canvasStatePutSchema>;

/** GET canvas state is per-layer. Strict to reject typos like ?foo=bar. */
export const canvasStateQuerySchema = z.object({ layer: LAYER }).strict();
export type CanvasStateQuery = z.infer<typeof canvasStateQuerySchema>;

// ---- list queries + route params -------------------------------------------

/** List entities/relationships for a model, optionally filtered to one layer. */
export const layerListQuerySchema = z
  .object({ layer: LAYER.optional() })
  .strict();
export type LayerListQuery = z.infer<typeof layerListQuerySchema>;

export const entityIdParamsSchema = z.object({
  id: uuidParam,
  entityId: uuidParam,
});
export type EntityIdParams = z.infer<typeof entityIdParamsSchema>;

export const attributeIdParamsSchema = z.object({
  id: uuidParam,
  entityId: uuidParam,
  attributeId: uuidParam,
});
export type AttributeIdParams = z.infer<typeof attributeIdParamsSchema>;

export const relationshipIdParamsSchema = z.object({
  id: uuidParam,
  relationshipId: uuidParam,
});
export type RelationshipIdParams = z.infer<typeof relationshipIdParamsSchema>;
