// Shared types for the Posts admin (Phase D). Importable from both server
// and client code (no server-only imports here — the server-side service
// module is lib/posts-admin/index.ts). Mirrors the lib/pages/types.ts
// pattern for visual + ergonomic parity across the two admin surfaces.

export type PostStatus = "draft" | "scheduled" | "published" | "archived";
export type PostVisibility = "listed" | "unlisted";

export const POST_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "archived",
] as const;

export const POST_VISIBILITIES = ["listed", "unlisted"] as const;

/**
 * What the admin list + edit views render. Includes drafts + scheduled +
 * archived. The optional join fields (authorName, categoryName) are
 * filled by the list/get queries via LEFT JOIN so the list table can
 * show byline + eyebrow without per-row lookups.
 */
export interface AdminPostView {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentMd: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImagePath: string | null;
  ogImageGeneratedAt: Date | null;
  authorId: string | null;
  categoryId: string | null;
  tags: string[];
  status: PostStatus;
  visibility: PostVisibility;
  wordCount: number;
  readingTimeMin: number;
  needsReview: boolean;
  sourceWpId: number | null;
  lastReviewedAt: Date | null;
  publishedAt: Date | null;
  scheduledPublishAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Joined for the list view + edit-page header. Null when the post has
  // no author / category FK (legal during migration backfill).
  authorName?: string | null;
  authorSlug?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
}

/**
 * Input shape for create/update. Same shape for both — the API route
 * distinguishes by presence of `id`. `expectedUpdatedAt` enforces
 * optimistic locking and lives only on PostUpdateSchema, not here.
 *
 * Status='archived' is rejected by the schema (archiving goes through a
 * separate DELETE endpoint, mirroring Pages CMS).
 */
export interface PostInput {
  slug: string;
  title: string;
  excerpt?: string | null;
  contentMd: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  authorId?: string | null;
  categoryId?: string | null;
  tags?: string[];
  status: PostStatus;
  visibility?: PostVisibility;
  needsReview?: boolean;
  lastReviewedAt?: Date | null;
  /**
   * Required when status === 'scheduled', forbidden otherwise. Validated
   * at the Zod boundary; the service layer enforces the future-anchor
   * check at save time (so a slow client form submit doesn't miss
   * because the wall clock advanced).
   */
  scheduledPublishAt?: Date | null;
}

/**
 * Revision row as the admin UI consumes it. Body is the markdown at the
 * point of save. diff_size_pct lets the UI highlight "material change"
 * revisions visually.
 */
export interface RevisionView {
  id: string;
  postId: string;
  title: string;
  contentMd: string;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  diffSizePct: string; // numeric(5,2) — Drizzle returns string, not number
  savedBy: string;
  savedAt: Date;
}

/**
 * Filter shape for the admin list view. status='all' means "every status
 * except archived" (archive lives in its own toggle). needsReview=true
 * narrows to the curation queue.
 */
export type AdminListFilter =
  | "all"
  | "draft"
  | "scheduled"
  | "published"
  | "needs_review"
  | "archived";

// ---------------------------------------------------------------------------
// Named errors. Routes translate these to HTTP status codes; tests
// pattern-match by `name`. Mirrors lib/pages/types.ts so the two admin
// surfaces have parallel ergonomics.
// ---------------------------------------------------------------------------

export class PostNotFoundError extends Error {
  override name = "PostNotFoundError";
}

export class DuplicateSlugError extends Error {
  override name = "DuplicateSlugError";
}

export class ConcurrentEditError extends Error {
  override name = "ConcurrentEditError";
  constructor(
    message: string,
    public currentUpdatedAt: Date,
  ) {
    super(message);
  }
}

export class RevisionNotFoundError extends Error {
  override name = "RevisionNotFoundError";
}

/**
 * Thrown when status='scheduled' but the supplied scheduledPublishAt
 * fails the service-layer freshness check (e.g. the client picked a
 * future time but several seconds elapsed between form submit + service
 * call, pushing the timestamp into the past). The Zod schema catches
 * "in the past at submit time"; this catches "in the past at save time."
 */
export class InvalidScheduleError extends Error {
  override name = "InvalidScheduleError";
}
