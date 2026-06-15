import { z } from "zod";

// ============================================================================
// Model Studio validation — Zod schemas for the data_model list/CRUD paths.
//
// Migrated from Spresso (packages/shared/src/utils/model-studio.schemas.ts),
// scoped to the LIST VIEW ONLY: enums + model create/update/list/id-param
// schemas. The canvas-layer schemas (entities, attributes, relationships,
// canvas state) are intentionally NOT migrated — the model detail page is a
// stub and the canvas is out of scope for this step.
//
// Enum values stay in lockstep with the varchar defaults on the `data_model`
// table in lib/db/schema.ts. Bounds mirror the column limits so a value that
// passes validation always fits the column (name varchar(200), description text).
// ============================================================================

// ---- enums -----------------------------------------------------------------

/** Last layer the user viewed on the canvas. */
export const LAYER = z.enum(["conceptual", "logical", "physical"]);
export type Layer = z.infer<typeof LAYER>;

/** Diagram notation preference (render-only, not data). */
export const NOTATION = z.enum(["ie", "idef1x"]);
export type Notation = z.infer<typeof NOTATION>;

/** Direction the modeller is approaching the model from at creation:
 *  - greenfield      : top-down, conceptual → logical → physical.
 *  - existing_system : bottom-up, physical → logical → conceptual
 *                      (reverse-engineering an existing database). */
export const ORIGIN_DIRECTION = z.enum(["greenfield", "existing_system"]);
export type OriginDirection = z.infer<typeof ORIGIN_DIRECTION>;

// ---- helpers ---------------------------------------------------------------

const trimmedNonEmpty = (min: number, max: number, field: string) =>
  z
    .string()
    .trim()
    .min(min, `${field} must not be empty`)
    .max(max, `${field} must be ${max} characters or fewer`);

export const uuidParam = z.string().uuid("Invalid UUID");

/** Open-ended metadata bag. Future governance/classification plugins write
 *  into this. Validated shallowly at MVP — shape-tightening happens later. */
export const metadataSchema = z.record(z.string(), z.unknown()).default({});

/** Tag list. Short lowercase slugs; capped to prevent abuse. */
export const tagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(30, "Too many tags")
  .default([]);

// ---- model -----------------------------------------------------------------

export const modelCreateSchema = z.object({
  name: trimmedNonEmpty(1, 200, "Name"),
  description: z
    .string()
    .max(10_000, "Description must be 10,000 characters or fewer")
    .optional()
    .nullable(),
  // Models live inside a project; the organisation is derived from
  // project.organisation_id server-side.
  projectId: uuidParam,
  activeLayer: LAYER.optional().default("conceptual"),
  notation: NOTATION.optional().default("ie"),
  /** Modelling-direction intent at creation. The dialog also passes
   *  activeLayer so the canvas opens on the matching layer; the two fields
   *  are decoupled because activeLayer changes as the user navigates layers,
   *  while originDirection is a fixed property of the model. */
  originDirection: ORIGIN_DIRECTION.optional().default("greenfield"),
  metadata: metadataSchema.optional(),
  tags: tagsSchema.optional(),
});
export type ModelCreate = z.infer<typeof modelCreateSchema>;

export const modelUpdateSchema = z
  .object({
    name: trimmedNonEmpty(1, 200, "Name").optional(),
    description: z.string().max(10_000).nullable().optional(),
    activeLayer: LAYER.optional(),
    notation: NOTATION.optional(),
    originDirection: ORIGIN_DIRECTION.optional(),
    metadata: metadataSchema.optional(),
    tags: tagsSchema.optional(),
    archivedAt: z.coerce.date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type ModelUpdate = z.infer<typeof modelUpdateSchema>;

export const modelIdParamsSchema = z.object({
  id: uuidParam,
});
export type ModelIdParams = z.infer<typeof modelIdParamsSchema>;

/** Listing filter: by project (default = all projects the user can see),
 *  optional archived flag, paging. Strict to reject typos like ?foo=bar. */
export const modelListQuerySchema = z
  .object({
    projectId: uuidParam.optional(),
    includeArchived: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    limit: z.coerce.number().int().positive().max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
  })
  .strict();
export type ModelListQuery = z.infer<typeof modelListQuerySchema>;
