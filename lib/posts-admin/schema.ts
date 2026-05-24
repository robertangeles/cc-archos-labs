import { z } from "zod";

// Zod schemas for the admin Posts API. Imported by both the route
// handlers and the admin UI for client-side hint validation. Mirrors
// lib/pages/schema.ts in shape so the form ergonomics stay parallel.
//
// CONTENT_MD_MAX_BYTES caps the markdown payload — keeps an admin from
// pasting a 100MB blob, keeps render time bounded, keeps the audit table
// from ballooning. 200KB allows even very long migrated posts; the
// longest WP post in the migration was ~30KB so this is comfortable.

export const CONTENT_MD_MAX_BYTES = 200_000;

// Slug shape: kebab-case lower, 1-200 chars (matches text() column +
// the WP slug length the migration already imports). Trimmed +
// lower-cased at parse time.
//
// Unlike Pages, Posts don't collide with reserved route names (the
// /blog/[slug] catch-all is namespaced), so no reserved-slug check.
export const PostSlugSchema = z
  .string()
  .min(1, "Slug is required.")
  .max(200, "Slug must be 200 characters or fewer.")
  .transform((s) => s.trim().toLowerCase())
  .refine(
    (s) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s),
    "Slug must be lower-case kebab-case (letters, digits, hyphens).",
  );

const PostStatusSchema = z.enum([
  "draft",
  "scheduled",
  "published",
  "archived",
] as const);
const PostVisibilitySchema = z.enum(["listed", "unlisted"] as const);

// Tags: free-form string array, 0-8 items, each 1-64 chars. The cap is
// editorial — 8 is plenty for a single post; more becomes noise on the
// public render. If a migrated post arrived with >8 tags, the form
// surfaces the count + asks the author to trim before save.
const TagsSchema = z
  .array(z.string().min(1).max(64).trim())
  .max(8, "A post can have at most 8 tags.")
  .optional()
  .default([]);

// Create schema: slug + contentMd are optional so the auto-create-draft
// path can POST `{ title }` from the first non-empty title keystroke and
// have the server generate a unique slug + default empty body. See
// wiki/synthesis/2026-05-24-blog-tidy-ceo-review.md E1.a for the
// rationale (single endpoint, single schema, server-generated slug with
// short random suffix avoids collision). The service layer
// (createPost in lib/posts-admin/index.ts) is responsible for the
// slug derivation + retry.
//
// Defined as its own schema rather than extending PostBaseSchema so the
// Update path keeps slug required (which it must — renaming an
// auto-generated slug is an explicit user action via the normal save).
export const PostCreateSchema = z
  .object({
    slug: PostSlugSchema.optional(),
    title: z.string().min(1, "Title is required.").max(200),
    excerpt: z.string().max(500).optional().nullable(),
    contentMd: z
      .string()
      .max(
        CONTENT_MD_MAX_BYTES,
        `Content exceeds the ${CONTENT_MD_MAX_BYTES.toLocaleString()}-byte limit.`,
      )
      .optional()
      .default(""),
    seoTitle: z.string().max(80).optional().nullable(),
    seoDescription: z.string().max(300).optional().nullable(),
    authorId: z.string().uuid().optional().nullable(),
    categoryId: z.string().uuid().optional().nullable(),
    tags: TagsSchema,
    status: PostStatusSchema.refine(
      (s) => s !== "archived",
      "Use the Archive action (DELETE) to archive a post.",
    )
      .optional()
      .default("draft"),
    visibility: PostVisibilitySchema.optional().default("listed"),
    needsReview: z.boolean().optional(),
    lastReviewedAt: z.coerce.date().optional().nullable(),
    scheduledPublishAt: z.coerce.date().optional().nullable(),
    ogImageAlt: z
      .string()
      .trim()
      .max(125, "Alt text must be 125 characters or fewer.")
      .optional()
      .nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "scheduled") {
      if (!data.scheduledPublishAt) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledPublishAt"],
          message:
            "Scheduled posts must include a scheduledPublishAt timestamp.",
        });
      } else if (data.scheduledPublishAt.getTime() <= Date.now()) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledPublishAt"],
          message: "scheduledPublishAt must be in the future.",
        });
      }
    } else if (data.scheduledPublishAt != null) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledPublishAt"],
        message: `scheduledPublishAt must be null when status is '${data.status}'.`,
      });
    }
  });

// PostUpdateSchema adds optimistic-locking: client supplies the
// updated_at it read, server rejects with 409 if the row has moved on.
// We extend the inner object so the .superRefine() composes cleanly.
export const PostUpdateSchema = z
  .object({
    slug: PostSlugSchema,
    title: z.string().min(1, "Title is required.").max(200),
    excerpt: z.string().max(500).optional().nullable(),
    contentMd: z
      .string()
      .max(
        CONTENT_MD_MAX_BYTES,
        `Content exceeds the ${CONTENT_MD_MAX_BYTES.toLocaleString()}-byte limit.`,
      ),
    seoTitle: z.string().max(80).optional().nullable(),
    seoDescription: z.string().max(300).optional().nullable(),
    authorId: z.string().uuid().optional().nullable(),
    categoryId: z.string().uuid().optional().nullable(),
    tags: TagsSchema,
    status: PostStatusSchema.refine(
      (s) => s !== "archived",
      "Use the Archive action (DELETE) to archive a post.",
    ),
    visibility: PostVisibilitySchema.optional().default("listed"),
    needsReview: z.boolean().optional(),
    lastReviewedAt: z.coerce.date().optional().nullable(),
    scheduledPublishAt: z.coerce.date().optional().nullable(),
    ogImageAlt: z
      .string()
      .trim()
      .max(125, "Alt text must be 125 characters or fewer.")
      .optional()
      .nullable(),
    expectedUpdatedAt: z.coerce.date({
      error: "expectedUpdatedAt is required for updates (optimistic locking).",
    }),
  })
  .superRefine((data, ctx) => {
    if (data.status === "scheduled") {
      if (!data.scheduledPublishAt) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledPublishAt"],
          message:
            "Scheduled posts must include a scheduledPublishAt timestamp.",
        });
      } else if (data.scheduledPublishAt.getTime() <= Date.now()) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledPublishAt"],
          message: "scheduledPublishAt must be in the future.",
        });
      }
    } else if (data.scheduledPublishAt != null) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledPublishAt"],
        message: `scheduledPublishAt must be null when status is '${data.status}'.`,
      });
    }
  });

// List-query params for GET /api/admin/posts. All optional; defaults to
// "every status except archived, no search, page 1 of 25".
export const PostListQuerySchema = z.object({
  status: z
    .enum([
      "all",
      "draft",
      "scheduled",
      "published",
      "needs_review",
      "archived",
    ] as const)
    .optional()
    .default("all"),
  search: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type PostCreateInput = z.infer<typeof PostCreateSchema>;
export type PostUpdateInput = z.infer<typeof PostUpdateSchema>;
export type PostListQuery = z.infer<typeof PostListQuerySchema>;
