import "server-only";
import { and, asc, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { page, pageBlock, pageRevision } from "../db/schema";
import { isReservedSlug } from "./reserved-slugs";
import { parseBlockProps } from "./blocks/registry";
import {
  ConcurrentEditError,
  DuplicateSlugError,
  InvalidBlockError,
  PageNotFoundError,
  ReservedSlugError,
  RevisionNotFoundError,
  type AdminPageView,
  type BlockInputView,
  type BlockView,
  type PageInput,
  type PageOgType,
  type PageStatus,
  type PageTemplate,
  type RevisionView,
} from "./types";

// Service module for the Pages CMS. The only writer of the page +
// page_revision tables. Routes call into this module — never the DB
// directly — so every mutation produces a revision row atomically.
//
// Pipeline (savePage):
//
//   input ──▶ validateSlug() ──▶ tx { ─▶ existing? ─▶ collisionCheck()
//                                       │                  │
//                                       ▼                  ▼
//                                  insertPage()         updatePage()
//                                       │                  │
//                                       └────► insertRevision() ◄──┘
//                                                          │
//                                                          ▼
//                                                       commit
//                                                          │
//                                                          ▼
//                                                    returns row
//
// Phase 1 keeps it small: 1 read, 1 write, 1 audit row, all in one tx.

const PG_UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List pages for the admin list view. Includes drafts + published; can
 * include or exclude archived rows via the param. Newest-updated first.
 */
export async function listPagesForAdmin(opts: {
  includeArchived: boolean;
}): Promise<AdminPageView[]> {
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
    .where(opts.includeArchived ? sql`true` : isNull(page.archivedAt))
    .orderBy(desc(page.updatedAt));

  return rows.map(rowToAdminView);
}

/**
 * Look up a single page by id for the admin edit view. Includes any
 * status (draft / published / archived).
 */
export async function getAdminPageById(
  id: string,
): Promise<AdminPageView | null> {
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
    .where(eq(page.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToAdminView(rows[0]);
}

/**
 * Load all blocks for a page in render order (position ASC). Returns
 * an empty array for long_form pages (which have no blocks rows).
 * Used by:
 *   - the catch-all when page.template === 'composed' (public render)
 *   - the admin edit view (to populate the BlocksEditor)
 */
export async function listBlocksForPage(
  pageId: string,
): Promise<BlockView[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: pageBlock.id,
      pageId: pageBlock.pageId,
      blockType: pageBlock.blockType,
      position: pageBlock.position,
      props: pageBlock.props,
    })
    .from(pageBlock)
    .where(eq(pageBlock.pageId, pageId))
    .orderBy(asc(pageBlock.position));
  return rows.map((r) => ({
    id: r.id,
    pageId: r.pageId,
    blockType: r.blockType,
    position: r.position,
    props: (r.props ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Revisions for a page, newest first. Drives the admin "history" view +
 * the restore flow.
 */
export async function listRevisions(pageId: string): Promise<RevisionView[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: pageRevision.id,
      pageId: pageRevision.pageId,
      title: pageRevision.title,
      contentMd: pageRevision.contentMd,
      seoTitle: pageRevision.seoTitle,
      seoDescription: pageRevision.seoDescription,
      diffSizePct: pageRevision.diffSizePct,
      savedBy: pageRevision.savedBy,
      savedAt: pageRevision.savedAt,
    })
    .from(pageRevision)
    .where(eq(pageRevision.pageId, pageId))
    .orderBy(desc(pageRevision.savedAt));
  return rows;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create a new page + initial revision in a single transaction.
 * When `template === 'composed'`, blocks are inserted in the same tx
 * (positions reassigned from array index) and snapshotted into the
 * initial revision.
 *
 * @throws ReservedSlugError if the slug is in RESERVED_SLUGS or empty.
 * @throws DuplicateSlugError on PG 23505 (slug already exists).
 * @throws Error if a block fails Zod validation (caller's 400 boundary).
 */
export async function createPage(
  input: PageInput,
  savedBy = "admin",
): Promise<AdminPageView> {
  const normalisedSlug = normaliseSlug(input.slug);
  if (isReservedSlug(normalisedSlug)) {
    throw new ReservedSlugError(`Slug "${normalisedSlug}" is reserved.`);
  }

  const template = (input.template ?? "long_form") as PageTemplate;
  const validatedBlocks =
    template === "composed" ? validateBlocks(input.blocks ?? []) : [];

  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(page)
        .values({
          slug: normalisedSlug,
          title: input.title,
          contentMd: input.contentMd,
          excerpt: input.excerpt ?? null,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
          template,
          status: input.status,
          ogType: (input.ogType ?? "article") as PageOgType,
          publishedAt: input.status === "published" ? new Date() : null,
          lastReviewedAt: input.lastReviewedAt ?? null,
        })
        .returning();

      const created = inserted[0];

      // Insert blocks (composed pages only). Skip the round-trip when
      // long_form so the create path stays cheap for legal pages.
      if (template === "composed" && validatedBlocks.length > 0) {
        await tx.insert(pageBlock).values(
          validatedBlocks.map((b, idx) => ({
            pageId: created.id,
            blockType: b.blockType,
            position: idx,
            props: b.props,
          })),
        );
      }

      await tx.insert(pageRevision).values({
        pageId: created.id,
        title: created.title,
        contentMd: created.contentMd,
        seoTitle: created.seoTitle,
        seoDescription: created.seoDescription,
        diffSizePct: "100.00",
        blocksSnapshot:
          template === "composed"
            ? validatedBlocks.map((b, idx) => ({
                blockType: b.blockType,
                position: idx,
                props: b.props,
              }))
            : null,
        savedBy,
      });

      return rowToAdminView(created);
    });
  } catch (err) {
    throw translateWriteError(err);
  }
}

/**
 * Update an existing page + append a revision in a single transaction.
 *
 * Optimistic locking via `expectedUpdatedAt`: if the row's current
 * updated_at doesn't match, throw ConcurrentEditError carrying the
 * current value so the admin UI can show "someone else saved this".
 *
 * @throws PageNotFoundError if no row with that id exists.
 * @throws ConcurrentEditError if expectedUpdatedAt is stale.
 * @throws ReservedSlugError if the new slug is reserved.
 * @throws DuplicateSlugError on PG 23505.
 */
export async function updatePage(
  id: string,
  input: PageInput,
  expectedUpdatedAt: Date,
  savedBy = "admin",
): Promise<AdminPageView> {
  const normalisedSlug = normaliseSlug(input.slug);
  if (isReservedSlug(normalisedSlug)) {
    throw new ReservedSlugError(`Slug "${normalisedSlug}" is reserved.`);
  }

  const template = (input.template ?? "long_form") as PageTemplate;
  const validatedBlocks =
    template === "composed" ? validateBlocks(input.blocks ?? []) : [];

  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      // Lock the row for the rest of the tx (defends against the
      // read-then-write race window).
      const existingRows = await tx
        .select({
          id: page.id,
          contentMd: page.contentMd,
          updatedAt: page.updatedAt,
          publishedAt: page.publishedAt,
          status: page.status,
        })
        .from(page)
        .where(eq(page.id, id))
        .for("update");

      if (existingRows.length === 0) {
        throw new PageNotFoundError(`Page "${id}" not found.`);
      }
      const existing = existingRows[0];

      // Optimistic locking. Compare millisecond timestamps; the client
      // round-trips the value as ISO and parses back. Tolerate equal-
      // by-value.
      if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConcurrentEditError(
          "Page was modified by another session.",
          existing.updatedAt,
        );
      }

      const diffSizePct = computeDiffSizePct(
        existing.contentMd,
        input.contentMd,
      );

      // Publish semantics:
      //  - draft -> published: set published_at = now()
      //  - already published -> published: keep original published_at
      //  - * -> draft: keep published_at as-is (history)
      const nextPublishedAt =
        input.status === "published" && existing.status !== "published"
          ? new Date()
          : existing.publishedAt;

      const updatedRows = await tx
        .update(page)
        .set({
          slug: normalisedSlug,
          title: input.title,
          contentMd: input.contentMd,
          excerpt: input.excerpt ?? null,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
          template,
          status: input.status,
          ogType: (input.ogType ?? "article") as PageOgType,
          publishedAt: nextPublishedAt,
          lastReviewedAt: input.lastReviewedAt ?? null,
          updatedAt: new Date(),
        })
        .where(eq(page.id, id))
        .returning();

      const updated = updatedRows[0];

      // Blocks rewrite: delete-all-then-insert is the simplest
      // semantics for the admin "drag-to-reorder + add + remove"
      // experience. Authors send the full current block list with
      // every save. CASCADE-safe — no FKs into page_block exist.
      // Phase 6 (transcluded blocks) will need a smarter diff.
      await tx.delete(pageBlock).where(eq(pageBlock.pageId, id));
      if (template === "composed" && validatedBlocks.length > 0) {
        await tx.insert(pageBlock).values(
          validatedBlocks.map((b, idx) => ({
            pageId: id,
            blockType: b.blockType,
            position: idx,
            props: b.props,
          })),
        );
      }

      await tx.insert(pageRevision).values({
        pageId: updated.id,
        title: updated.title,
        contentMd: updated.contentMd,
        seoTitle: updated.seoTitle,
        seoDescription: updated.seoDescription,
        diffSizePct: diffSizePct.toFixed(2),
        blocksSnapshot:
          template === "composed"
            ? validatedBlocks.map((b, idx) => ({
                blockType: b.blockType,
                position: idx,
                props: b.props,
              }))
            : null,
        savedBy,
      });

      return rowToAdminView(updated);
    });
  } catch (err) {
    throw translateWriteError(err);
  }
}

/**
 * Soft-delete: stamp archived_at. Public surfaces hide archived pages
 * (the catch-all filters on archived_at IS NULL). Revisions preserved.
 * Restore via restoreFromArchive() or just cleared archived_at.
 */
export async function archivePage(id: string): Promise<AdminPageView> {
  const db = getDb();
  const rows = await db
    .update(page)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(page.id, id), isNull(page.archivedAt)))
    .returning();
  if (rows.length === 0) {
    throw new PageNotFoundError(
      `Page "${id}" not found (or already archived).`,
    );
  }
  return rowToAdminView(rows[0]);
}

/**
 * Inverse of archivePage. Restores by clearing archived_at. Status is
 * preserved (an archived published page becomes published-and-not-
 * archived; an archived draft stays a draft).
 */
export async function restoreFromArchive(id: string): Promise<AdminPageView> {
  const db = getDb();
  const rows = await db
    .update(page)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(page.id, id), isNotNull(page.archivedAt)))
    .returning();
  if (rows.length === 0) {
    throw new PageNotFoundError(
      `Page "${id}" not found (or not archived).`,
    );
  }
  return rowToAdminView(rows[0]);
}

/**
 * Restore a prior revision's content. Creates a NEW revision row
 * reflecting the restore (so the audit trail shows when + by whom).
 * Slug + status are NOT touched — restore is a content-only operation.
 *
 * @throws RevisionNotFoundError if the revision doesn't belong to the page.
 * @throws PageNotFoundError if the page no longer exists.
 */
export async function restoreRevision(
  pageId: string,
  revisionId: string,
  savedBy = "admin",
): Promise<{ page: AdminPageView; revision: RevisionView }> {
  const db = getDb();
  return await db.transaction(async (tx) => {
    const revRows = await tx
      .select()
      .from(pageRevision)
      .where(
        and(eq(pageRevision.id, revisionId), eq(pageRevision.pageId, pageId)),
      )
      .limit(1);
    if (revRows.length === 0) {
      throw new RevisionNotFoundError(
        `Revision ${revisionId} not found for page ${pageId}.`,
      );
    }
    const rev = revRows[0];

    const currentRows = await tx
      .select({ contentMd: page.contentMd })
      .from(page)
      .where(eq(page.id, pageId))
      .for("update");
    if (currentRows.length === 0) {
      throw new PageNotFoundError(`Page "${pageId}" not found.`);
    }
    const diffSizePct = computeDiffSizePct(
      currentRows[0].contentMd,
      rev.contentMd,
    );

    const updatedRows = await tx
      .update(page)
      .set({
        title: rev.title,
        contentMd: rev.contentMd,
        seoTitle: rev.seoTitle,
        seoDescription: rev.seoDescription,
        updatedAt: new Date(),
      })
      .where(eq(page.id, pageId))
      .returning();

    const newRevRows = await tx
      .insert(pageRevision)
      .values({
        pageId,
        title: rev.title,
        contentMd: rev.contentMd,
        seoTitle: rev.seoTitle,
        seoDescription: rev.seoDescription,
        diffSizePct: diffSizePct.toFixed(2),
        savedBy: `${savedBy} (restore of ${rev.id.slice(0, 8)})`,
      })
      .returning();

    return {
      page: rowToAdminView(updatedRows[0]),
      revision: newRevRows[0],
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a percentage delta between two markdown blobs. Simple length
 * heuristic (good enough for the "material change" signal — exact
 * Levenshtein would cost more than it's worth at this scale).
 *
 * Returns a number in [0, 100], two decimal precision intended.
 */
export function computeDiffSizePct(before: string, after: string): number {
  if (before === after) return 0;
  if (before.length === 0) return 100;
  const lenDelta = Math.abs(after.length - before.length);
  const baseline = Math.max(before.length, 1);
  const pct = (lenDelta / baseline) * 100;
  return Math.min(100, pct);
}

function normaliseSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

function rowToAdminView(row: {
  id: string;
  slug: string;
  title: string;
  contentMd: string;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  template: string;
  status: string;
  ogType: string;
  publishedAt: Date | null;
  lastReviewedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AdminPageView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    contentMd: row.contentMd,
    excerpt: row.excerpt,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    template: row.template as PageTemplate,
    status: row.status as PageStatus,
    ogType: row.ogType as PageOgType,
    publishedAt: row.publishedAt,
    lastReviewedAt: row.lastReviewedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Validate every block in an admin-supplied list. Each block's props
 * is parsed against the registry's Zod schema; on failure we throw
 * with a precise path so the admin API returns a useful 400.
 *
 * Returns the parsed (typed) blocks. Caller passes these into the
 * tx insert.
 */
function validateBlocks(blocks: BlockInputView[]): Array<{
  blockType: string;
  props: Record<string, unknown>;
}> {
  return blocks.map((b, idx) => {
    try {
      const parsed = parseBlockProps(b.blockType, b.props) as Record<
        string,
        unknown
      >;
      return { blockType: b.blockType, props: parsed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new InvalidBlockError(
        `Block at position ${idx} (${b.blockType}): ${message}`,
      );
    }
  });
}

function translateWriteError(err: unknown): Error {
  if (err instanceof ReservedSlugError) return err;
  if (err instanceof DuplicateSlugError) return err;
  if (err instanceof ConcurrentEditError) return err;
  if (err instanceof PageNotFoundError) return err;
  if (err instanceof RevisionNotFoundError) return err;
  if (err instanceof InvalidBlockError) return err;

  // postgres.js exposes the SQLSTATE on `code`.
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
  ) {
    return new DuplicateSlugError("A page with that slug already exists.");
  }
  return err as Error;
}
