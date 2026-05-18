// Shared types for the Pages CMS. Importable from both server and client
// code (no server-only imports here — the server-side service module is
// lib/pages/index.ts).

export type PageStatus = "draft" | "published" | "archived";
export type PageTemplate = "long_form"; // Phase 2 adds 'composed'.
export type PageOgType = "article" | "website";

// What public surfaces see. Always status='published' AND archived_at IS NULL.
export interface PublishedPageView {
  id: string;
  slug: string;
  title: string;
  contentMd: string;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  template: PageTemplate;
  ogType: PageOgType;
  publishedAt: Date;
  lastReviewedAt: Date | null;
  updatedAt: Date;
}

// What admins see. Includes drafts + archived. Carries the fields needed
// to drive the admin form, plus revision count for the list view.
export interface AdminPageView {
  id: string;
  slug: string;
  title: string;
  contentMd: string;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  template: PageTemplate;
  status: PageStatus;
  ogType: PageOgType;
  publishedAt: Date | null;
  lastReviewedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Revision row as the admin UI consumes it. Body is the markdown at the
// point of save. diff_size_pct lets the UI highlight "material change"
// revisions visually.
export interface RevisionView {
  id: string;
  pageId: string;
  title: string;
  contentMd: string;
  seoTitle: string | null;
  seoDescription: string | null;
  diffSizePct: string; // numeric(5,2) — Drizzle returns string, not number
  savedBy: string;
  savedAt: Date;
}

// Input shape for create/update. Same shape for both — the API route
// distinguishes by presence of `id`. `expectedUpdatedAt` enforces
// optimistic locking; on first-create it's null.
export interface PageInput {
  slug: string;
  title: string;
  contentMd: string;
  excerpt?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  template?: PageTemplate;
  status: PageStatus;
  ogType?: PageOgType;
  lastReviewedAt?: Date | null;
}

// Named errors. Routes translate these to HTTP status codes; tests pattern-
// match by `name`. Match the booking-domain error-class pattern in
// lib/errors/booking.ts (named subclasses, no untyped throws).
export class ReservedSlugError extends Error {
  override name = "ReservedSlugError";
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
export class PageNotFoundError extends Error {
  override name = "PageNotFoundError";
}
export class RevisionNotFoundError extends Error {
  override name = "RevisionNotFoundError";
}
