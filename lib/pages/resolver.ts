import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { page } from "../db/schema";
import { isReservedSlug } from "./reserved-slugs";
import { isPagesCmsEnabled } from "./feature-flag";
import type {
  PublishedPageView,
  AdminPageView,
  PageStatus,
  PageTemplate,
  PageOgType,
} from "./types";

// Resolves an incoming public slug to a renderable page (or notFound).
// Sole reader for the catch-all at app/[...slug]/page.tsx. Pure-ish:
// the only side effects are DB reads + logger calls.
//
// State diagram:
//
//   slug ──▶ ┌──────────────────┐
//            │ reserved?        │── yes ──▶ not_found
//            └────────┬─────────┘
//                     │ no
//                     ▼
//            ┌──────────────────┐
//            │ feature flag on? │── no  ──▶ not_found
//            └────────┬─────────┘
//                     │ yes
//                     ▼
//            ┌──────────────────┐
//            │ findPage(slug)   │── nil ──▶ not_found
//            └────────┬─────────┘
//                     │ row
//                     ▼
//            ┌──────────────────────┐
//            │ archived_at NOT NULL │── yes ──▶ not_found
//            └──────────┬───────────┘
//                       │ no
//                       ▼
//            ┌──────────────────────┐
//            │ status == 'draft'    │── yes ──▶ viewer.isAdmin?
//            └──────────┬───────────┘            │
//                       │ no                     ├─ yes ──▶ preview
//                       ▼                        └─ no  ──▶ not_found
//                  render

export type ResolveResult =
  | { kind: "render"; page: PublishedPageView }
  | { kind: "preview"; page: PublishedPageView }
  | { kind: "not_found" };

export interface Viewer {
  isAdmin: boolean;
}

/**
 * Resolve a slug to a public render result.
 *
 * Returns:
 *  - { kind: 'render', page }   when published + not archived
 *  - { kind: 'preview', page }  when draft + viewer.isAdmin
 *  - { kind: 'not_found' }      otherwise (reserved, flag-off, missing,
 *                                          archived, draft + non-admin)
 *
 * Note on draft preview: this v1 returns the same shape as `render`.
 * The catch-all can show a banner ("Draft preview"). Public surfaces
 * always see 'not_found' for drafts.
 */
export async function resolvePage(
  slug: string,
  viewer: Viewer,
): Promise<ResolveResult> {
  // Layer 1: reserved-slug short-circuit. Defends against any path that
  // bypassed the framework's static-segment match precedence.
  if (isReservedSlug(slug)) return { kind: "not_found" };

  // Layer 2: feature flag. Fails-open on DB error (see feature-flag.ts).
  const enabled = await isPagesCmsEnabled();
  if (!enabled) return { kind: "not_found" };

  // Layer 3: DB lookup. This route already filters out archived +
  // unpublished, so a hit here is renderable. For draft preview we
  // need a wider query, so split the path.
  if (viewer.isAdmin) {
    // Admin: allow draft preview. Read every status except archived.
    const adminRow = await fetchAdminVisible(slug);
    if (!adminRow) return { kind: "not_found" };
    if (adminRow.status === "archived") return { kind: "not_found" };
    if (adminRow.status === "draft") {
      return {
        kind: "preview",
        page: adminViewToPublished(adminRow),
      };
    }
    // status === 'published'
    return {
      kind: "render",
      page: adminViewToPublished(adminRow),
    };
  }

  // Public path. One indexed lookup, all filters in SQL.
  const row = await fetchPublishedView(slug);
  if (!row) return { kind: "not_found" };
  return { kind: "render", page: row };
}

async function fetchPublishedView(
  slug: string,
): Promise<PublishedPageView | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: page.id,
      slug: page.slug,
      title: page.title,
      contentMd: page.contentMd,
      excerpt: page.excerpt,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
      template: page.template,
      ogType: page.ogType,
      publishedAt: page.publishedAt,
      lastReviewedAt: page.lastReviewedAt,
      updatedAt: page.updatedAt,
    })
    .from(page)
    .where(
      and(
        eq(page.slug, slug),
        eq(page.status, "published"),
        isNull(page.archivedAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    contentMd: r.contentMd,
    excerpt: r.excerpt,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    template: r.template as PageTemplate,
    ogType: r.ogType as PageOgType,
    publishedAt: r.publishedAt!, // not-null when status='published'
    lastReviewedAt: r.lastReviewedAt,
    updatedAt: r.updatedAt,
  };
}

async function fetchAdminVisible(slug: string): Promise<AdminPageView | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: page.id,
      slug: page.slug,
      title: page.title,
      contentMd: page.contentMd,
      excerpt: page.excerpt,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
      template: page.template,
      status: page.status,
      ogType: page.ogType,
      publishedAt: page.publishedAt,
      lastReviewedAt: page.lastReviewedAt,
      archivedAt: page.archivedAt,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    })
    .from(page)
    .where(eq(page.slug, slug))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    contentMd: r.contentMd,
    excerpt: r.excerpt,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    template: r.template as PageTemplate,
    status: r.status as PageStatus,
    ogType: r.ogType as PageOgType,
    publishedAt: r.publishedAt,
    lastReviewedAt: r.lastReviewedAt,
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function adminViewToPublished(row: AdminPageView): PublishedPageView {
  // Drafts may not have a publishedAt yet — use updatedAt as a safe
  // placeholder for the renderer's "last updated" stamp.
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    contentMd: row.contentMd,
    excerpt: row.excerpt,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    template: row.template,
    ogType: row.ogType,
    publishedAt: row.publishedAt ?? row.updatedAt,
    lastReviewedAt: row.lastReviewedAt,
    updatedAt: row.updatedAt,
  };
}

