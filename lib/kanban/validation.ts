import { z } from "zod";

// ============================================================================
// Kanban validation — Zod schemas for columns, cards, and labels. Bounds mirror
// the varchar limits in lib/db/schema.ts. Free-text is trimmed; empty strings
// on optional fields normalise to undefined so they never overwrite a column
// with "" — the service maps undefined → null where appropriate.
// ============================================================================

/** Trimmed string, bounded to `max`, optional. "" → undefined (not stored). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/** Trimmed, non-empty, bounded required string. */
const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** ISO calendar date (YYYY-MM-DD), optional. Matches Drizzle date mode:string. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/** Card priority. Matches the column default 'medium'. */
const priority = z.enum(["low", "medium", "high", "urgent"]);

/** Non-negative integer sort position. */
const sortOrder = z.number().int().min(0);

// ---- column ----------------------------------------------------------------

export const createColumnSchema = z.object({
  name: requiredText(100),
  color: optionalText(20),
  sortOrder: sortOrder.optional(),
});

export const updateColumnSchema = z
  .object({
    name: requiredText(100).optional(),
    color: optionalText(20),
    sortOrder: sortOrder.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

// ---- card ------------------------------------------------------------------

export const createCardSchema = z.object({
  columnId: z.string().uuid("Invalid column id"),
  title: requiredText(500),
  description: optionalText(20000),
  priority: priority.optional(),
  dueDate: isoDate,
  sortOrder: sortOrder.optional(),
  assigneeId: z.string().uuid("Invalid assignee id").optional(),
  coverImageUrl: optionalText(2000),
});

// Update card: every field optional (no columnId — moving lives in moveCard).
export const updateCardSchema = z
  .object({
    title: requiredText(500).optional(),
    description: optionalText(20000),
    priority: priority.optional(),
    dueDate: isoDate,
    sortOrder: sortOrder.optional(),
    assigneeId: z.string().uuid("Invalid assignee id").nullable().optional(),
    coverImageUrl: optionalText(2000),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const moveCardSchema = z.object({
  toColumnId: z.string().uuid("Invalid target column id"),
  toSortOrder: sortOrder,
});

// ---- label -----------------------------------------------------------------

export const createLabelSchema = z.object({
  name: requiredText(100),
  color: optionalText(20),
});

export const assignLabelSchema = z.object({
  labelId: z.string().uuid("Invalid label id"),
});

export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
export type MoveCardInput = z.infer<typeof moveCardSchema>;
export type CreateLabelInput = z.infer<typeof createLabelSchema>;
export type AssignLabelInput = z.infer<typeof assignLabelSchema>;
