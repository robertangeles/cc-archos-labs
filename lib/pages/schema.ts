import { z } from "zod";
import { isReservedSlug } from "./reserved-slugs";

// Zod schemas for the admin API. Imported by both the route handlers
// and the admin UI for client-side hint validation.
//
// CONTENT_MD_MAX_BYTES caps the markdown payload — keeps an admin from
// pasting a 100MB blob, keeps render time bounded, keeps the audit table
// from ballooning. 200KB allows even very long legal documents (Privacy
// is ~9KB).

export const CONTENT_MD_MAX_BYTES = 200_000;

// Slug shape: kebab-case lower, 1-80 chars. Must not be in
// RESERVED_SLUGS. Trimmed + lower-cased at parse time.
export const SlugSchema = z
  .string()
  .min(1, "Slug is required.")
  .max(80, "Slug must be 80 characters or fewer.")
  .transform((s) => s.trim().toLowerCase())
  .refine(
    (s) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s),
    "Slug must be lower-case kebab-case (letters, digits, hyphens).",
  )
  .refine(
    (s) => !isReservedSlug(s),
    "This slug is reserved — pick a different slug.",
  );

const PageStatusSchema = z.enum(["draft", "published", "archived"] as const);
const PageOgTypeSchema = z.enum(["article", "website"] as const);
const PageTemplateSchema = z.enum(["long_form"] as const); // Phase 2 adds 'composed'.

// Input shape for create + update. `expectedUpdatedAt` is REQUIRED on
// update (carries the optimistic-lock value) but absent on create.
// Status='archived' is rejected at the admin save path — archive is a
// separate endpoint to keep intent explicit.
export const PageCreateSchema = z.object({
  slug: SlugSchema,
  title: z.string().min(1, "Title is required.").max(200),
  contentMd: z
    .string()
    .max(
      CONTENT_MD_MAX_BYTES,
      `Content exceeds the ${CONTENT_MD_MAX_BYTES.toLocaleString()}-byte limit.`,
    ),
  excerpt: z.string().max(500).optional().nullable(),
  seoTitle: z.string().max(80).optional().nullable(),
  seoDescription: z.string().max(300).optional().nullable(),
  template: PageTemplateSchema.optional(),
  status: PageStatusSchema.refine(
    (s) => s !== "archived",
    "Use the Archive action to archive a page.",
  ),
  ogType: PageOgTypeSchema.optional(),
  lastReviewedAt: z.coerce.date().optional().nullable(),
});

export const PageUpdateSchema = PageCreateSchema.extend({
  expectedUpdatedAt: z.coerce.date({
    error: "expectedUpdatedAt is required for updates (optimistic locking).",
  }),
});

export type PageCreateInput = z.infer<typeof PageCreateSchema>;
export type PageUpdateInput = z.infer<typeof PageUpdateSchema>;
