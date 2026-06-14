import { z } from "zod";

// ============================================================================
// Projects validation — Zod schemas for the project + membership + activity
// write paths. Bounds mirror the varchar limits in lib/db/schema.ts so a value
// that passes validation always fits the column. All free-text is trimmed;
// empty strings on optional fields normalise to undefined so they never
// overwrite a column with "" — the service maps undefined → null where needed.
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

/** Project status values. v1: active | on_hold | completed | archived. */
const projectStatus = z.enum(["active", "on_hold", "completed", "archived"]);

// ---- project ---------------------------------------------------------------

export const createProjectSchema = z.object({
  name: requiredText(255),
  description: optionalText(20000),
  clientId: z.string().uuid("Invalid client id").optional(),
  status: projectStatus.optional(),
  startDate: isoDate,
  endDate: isoDate,
});

// Update: every field optional, but reject an empty object so a no-op PATCH is
// a 400 rather than a silent success. name stays non-empty when present.
export const updateProjectSchema = createProjectSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field is required" },
);

// ---- project member --------------------------------------------------------

/** Membership role within a single project. */
const memberRole = z.enum(["owner", "admin", "member"]);

export const addProjectMemberSchema = z.object({
  userId: z.string().uuid("Invalid user id"),
  role: memberRole.optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
