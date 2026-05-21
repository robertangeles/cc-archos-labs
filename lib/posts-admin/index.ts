import "server-only";
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { generateOgImage } from "../og";
import { embedPostContent, EmbeddingError } from "../embeddings";
import { getDb } from "../db";
import { author, category, post, postRevision } from "../db/schema";
import { computeWordCount, readingTimeMinutes } from "./word-count";
import {
  ConcurrentEditError,
  DuplicateSlugError,
  InvalidScheduleError,
  PostNotFoundError,
  RevisionNotFoundError,
  type AdminPostView,
  type AuthorLookup,
  type CategoryLookup,
  type PostInput,
  type PostStatus,
  type PostVisibility,
  type RevisionView,
} from "./types";
import type { PostListQuery } from "./schema";

// Service module for the Posts CMS (Phase D — Translation Layer).
// The only writer of the `post` + `post_revision` tables outside the
// migration script. Routes call into this module — never the DB
// directly — so every mutation produces a revision row atomically and
// every save can fire its side effects (OG regen + embedding regen)
// through a single chokepoint.
//
// Pipeline (updatePost):
//
//   input ──▶ validateAndNormalise ──▶ tx { lock row ──▶ optimistic-lock
//                                                  │              ──▶ stale? throw
//                                                  ▼
//                                          computeWordCount / readingTime
//                                                  │
//                                                  ▼
//                                          update post row
//                                                  │
//                                                  ▼
//                                          insert revision row
//                                                  │
//                                                  ▼
//                                              commit }
//                                                  │
//                                                  ▼
//                              runSideEffectsAfterUpdate (OUTSIDE tx)
//                              ┌─────────────┬─────────────────┐
//                              │ title/excerpt? regen OG       │
//                              │ contentMd diff>5%? regen embd │
//                              │ Promise.allSettled            │
//                              │ each writes back to post in a │
//                              │ small follow-up UPDATE        │
//                              └───────────────────────────────┘
//                                                  │
//                                                  ▼
//                                       return { post, sideEffects }
//
// Side effects run AFTER commit so we don't hold a row lock during the
// embedding API call (~1-2s). Failures are captured into the response
// rather than rolled back — the post save is the source of truth; OG
// + embedding are derived and can be re-run manually.

const PG_UNIQUE_VIOLATION = "23505";

// Threshold above which a content edit triggers an embedding regen.
// Keeps cost down for typo-class edits while still catching genuine
// semantic shifts. Mirrors the same heuristic used in the Pages
// computeDiffSizePct helper.
const EMBEDDING_REGEN_THRESHOLD_PCT = 5;

export interface SideEffectResult {
  ogRegenerated: "ok" | "failed" | "skipped";
  ogError?: string;
  embeddingRegenerated: "ok" | "failed" | "skipped";
  embeddingError?: string;
}

export interface SaveResult {
  post: AdminPostView;
  sideEffects: SideEffectResult;
}

export interface ListResult {
  posts: AdminPostView[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Paginated admin list view with status/search/category filters. JOINs
 * author + category so the list table can show byline + eyebrow without
 * per-row lookups.
 *
 * Sort: scheduled posts first (by scheduledPublishAt ASC so the next-up
 * post sits at the top), then everything else by updatedAt DESC.
 */
export async function listPostsForAdmin(
  query: PostListQuery,
): Promise<ListResult> {
  const db = getDb();
  const pageSize = Math.max(1, Math.min(100, query.pageSize));
  const page = Math.max(1, query.page);
  const offset = (page - 1) * pageSize;

  const filters: ReturnType<typeof eq>[] = [];

  // Status filter. 'all' means every status except archived (archived
  // has its own toggle). 'needs_review' is a meta-filter that maps to
  // needs_review=true on top of the all-non-archived base.
  switch (query.status) {
    case "all":
      filters.push(isNull(post.archivedAt));
      break;
    case "draft":
      filters.push(eq(post.status, "draft" satisfies PostStatus));
      filters.push(isNull(post.archivedAt));
      break;
    case "scheduled":
      filters.push(eq(post.status, "scheduled" satisfies PostStatus));
      filters.push(isNull(post.archivedAt));
      break;
    case "published":
      filters.push(eq(post.status, "published" satisfies PostStatus));
      filters.push(isNull(post.archivedAt));
      break;
    case "needs_review":
      filters.push(eq(post.needsReview, true));
      filters.push(isNull(post.archivedAt));
      break;
    case "archived":
      filters.push(isNotNull(post.archivedAt));
      break;
  }

  if (query.search) {
    const pattern = `%${query.search.trim()}%`;
    filters.push(
      or(ilike(post.title, pattern), ilike(post.slug, pattern))!,
    );
  }
  if (query.categoryId) {
    filters.push(eq(post.categoryId, query.categoryId));
  }

  const where = filters.length ? and(...filters) : sql`true`;

  // Two-stage sort: scheduled-soon at the top, then everything else by
  // updatedAt DESC. CASE keeps it as a single ORDER BY clause so the
  // partial index on (status, scheduled_publish_at) can still help.
  const rows = await db
    .select({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      contentMd: post.contentMd,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      ogImagePath: post.ogImagePath,
      ogImageGeneratedAt: post.ogImageGeneratedAt,
      ogImageAlt: post.ogImageAlt,
      ogImageWidth: post.ogImageWidth,
      ogImageHeight: post.ogImageHeight,
      ogImageFilename: post.ogImageFilename,
      ogImageMimeType: post.ogImageMimeType,
      ogImageSizeKb: post.ogImageSizeKb,
      ogImageUploadedBy: post.ogImageUploadedBy,
      ogImageUploadedAt: post.ogImageUploadedAt,
      ogImageChecksum: post.ogImageChecksum,
      ogImageR2Key: post.ogImageR2Key,
      ogImageDeletedAt: post.ogImageDeletedAt,
      authorId: post.authorId,
      categoryId: post.categoryId,
      tags: post.tags,
      status: post.status,
      visibility: post.visibility,
      wordCount: post.wordCount,
      readingTimeMin: post.readingTimeMin,
      needsReview: post.needsReview,
      sourceWpId: post.sourceWpId,
      lastReviewedAt: post.lastReviewedAt,
      publishedAt: post.publishedAt,
      scheduledPublishAt: post.scheduledPublishAt,
      archivedAt: post.archivedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      authorName: author.name,
      authorSlug: author.slug,
      categoryName: category.name,
      categorySlug: category.slug,
    })
    .from(post)
    .leftJoin(author, eq(post.authorId, author.id))
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(where)
    // Sort: scheduled posts soonest-first at top, then everything else
    // by publication date desc. publishedAt is the original WP date for
    // migrated rows + the admin-publish moment for new rows — far more
    // meaningful for chronological browsing than updatedAt, which is
    // identical across all 253 migrated posts (= migration timestamp).
    // NULLS LAST so drafts (no publishedAt) fall to the bottom; tied on
    // publishedAt, latest updatedAt wins.
    .orderBy(
      sql`CASE WHEN ${post.status} = 'scheduled' THEN 0 ELSE 1 END`,
      asc(post.scheduledPublishAt),
      sql`${post.publishedAt} DESC NULLS LAST`,
      desc(post.updatedAt),
    )
    .limit(pageSize)
    .offset(offset);

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(post)
    .where(where);
  const totalCount = countRows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    posts: rows.map(rowToAdminView),
    totalCount,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Look up a single post by id for the admin edit view. Includes any
 * status (draft / scheduled / published / archived). LEFT JOINs author
 * + category so the edit view can show byline + eyebrow without an
 * extra round-trip.
 */
export async function getAdminPostById(
  id: string,
): Promise<AdminPostView | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      contentMd: post.contentMd,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      ogImagePath: post.ogImagePath,
      ogImageGeneratedAt: post.ogImageGeneratedAt,
      ogImageAlt: post.ogImageAlt,
      ogImageWidth: post.ogImageWidth,
      ogImageHeight: post.ogImageHeight,
      ogImageFilename: post.ogImageFilename,
      ogImageMimeType: post.ogImageMimeType,
      ogImageSizeKb: post.ogImageSizeKb,
      ogImageUploadedBy: post.ogImageUploadedBy,
      ogImageUploadedAt: post.ogImageUploadedAt,
      ogImageChecksum: post.ogImageChecksum,
      ogImageR2Key: post.ogImageR2Key,
      ogImageDeletedAt: post.ogImageDeletedAt,
      authorId: post.authorId,
      categoryId: post.categoryId,
      tags: post.tags,
      status: post.status,
      visibility: post.visibility,
      wordCount: post.wordCount,
      readingTimeMin: post.readingTimeMin,
      needsReview: post.needsReview,
      sourceWpId: post.sourceWpId,
      lastReviewedAt: post.lastReviewedAt,
      publishedAt: post.publishedAt,
      scheduledPublishAt: post.scheduledPublishAt,
      archivedAt: post.archivedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      authorName: author.name,
      authorSlug: author.slug,
      categoryName: category.name,
      categorySlug: category.slug,
    })
    .from(post)
    .leftJoin(author, eq(post.authorId, author.id))
    .leftJoin(category, eq(post.categoryId, category.id))
    .where(eq(post.id, id))
    .limit(1);

  if (rows.length === 0) return null;
  return rowToAdminView(rows[0]);
}

/**
 * Slim author list for the editor's Author dropdown. Ordered by name.
 */
export async function listAuthorsForAdmin(): Promise<AuthorLookup[]> {
  const db = getDb();
  return db
    .select({
      id: author.id,
      slug: author.slug,
      name: author.name,
    })
    .from(author)
    .orderBy(asc(author.name));
}

/**
 * Slim category list for the editor's Category dropdown. Ordered by
 * name. (lib/posts.ts has a fatter `listAllCategories()` that includes
 * description — kept separate so admin and public reader stay
 * decoupled.)
 */
export async function listCategoriesForAdmin(): Promise<CategoryLookup[]> {
  const db = getDb();
  return db
    .select({
      id: category.id,
      slug: category.slug,
      name: category.name,
    })
    .from(category)
    .orderBy(asc(category.name));
}

/**
 * Revisions for a post, newest first. Drives the admin "history" view
 * and the restore flow.
 */
export async function listRevisionsForPost(
  postId: string,
): Promise<RevisionView[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: postRevision.id,
      postId: postRevision.postId,
      title: postRevision.title,
      contentMd: postRevision.contentMd,
      excerpt: postRevision.excerpt,
      seoTitle: postRevision.seoTitle,
      seoDescription: postRevision.seoDescription,
      diffSizePct: postRevision.diffSizePct,
      savedBy: postRevision.savedBy,
      savedAt: postRevision.savedAt,
    })
    .from(postRevision)
    .where(eq(postRevision.postId, postId))
    .orderBy(desc(postRevision.savedAt));
  return rows;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create a new post + initial revision in a single transaction. Side
 * effects (OG regen, embedding regen) run AFTER the transaction commits
 * — failures are captured into the return value rather than rolled back.
 *
 * @throws DuplicateSlugError on PG 23505 (slug already exists).
 * @throws InvalidScheduleError if status='scheduled' but the supplied
 *   scheduledPublishAt is not in the future at service time.
 */
export async function createPost(
  input: PostInput,
  savedBy = "admin",
): Promise<SaveResult> {
  const normalised = normalisePostInput(input);
  enforceScheduleInvariant(normalised);
  const wordCount = computeWordCount(normalised.contentMd);
  const readingTimeMin = readingTimeMinutes(wordCount);

  const db = getDb();
  let created: AdminPostView;
  try {
    created = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(post)
        .values({
          slug: normalised.slug,
          title: normalised.title,
          contentMd: normalised.contentMd,
          excerpt: normalised.excerpt,
          seoTitle: normalised.seoTitle,
          seoDescription: normalised.seoDescription,
          authorId: normalised.authorId,
          categoryId: normalised.categoryId,
          tags: normalised.tags,
          status: normalised.status,
          visibility: normalised.visibility,
          needsReview: normalised.needsReview,
          lastReviewedAt: normalised.lastReviewedAt,
          scheduledPublishAt: normalised.scheduledPublishAt,
          ogImageAlt: normalised.ogImageAlt,
          // Publish semantics on create:
          //   - draft / scheduled / archived: publishedAt stays NULL
          //   - published: stamp publishedAt = now()
          publishedAt:
            normalised.status === "published" ? new Date() : null,
          wordCount,
          readingTimeMin,
        })
        .returning();

      const row = inserted[0];

      await tx.insert(postRevision).values({
        postId: row.id,
        title: row.title,
        contentMd: row.contentMd,
        excerpt: row.excerpt,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        diffSizePct: "100.00",
        savedBy,
      });

      return rowToAdminView({
        ...row,
        authorName: null,
        authorSlug: null,
        categoryName: null,
        categorySlug: null,
      });
    });
  } catch (err) {
    throw translateWriteError(err);
  }

  // Side effects after commit. On create, both OG + embedding always
  // fire (every field is "new" relative to the zero-state).
  const sideEffects = await runSideEffectsAfterSave({
    postId: created.id,
    titleOrExcerptChanged: true,
    embeddingShouldRefresh: true,
  });

  // Re-read so the response reflects any side-effect column updates
  // (ogImagePath, ogImageGeneratedAt). Cheap single-row lookup.
  const refreshed = (await getAdminPostById(created.id)) ?? created;
  return { post: refreshed, sideEffects };
}

/**
 * Update an existing post + append a revision in a single transaction.
 * Side effects run AFTER commit, see runSideEffectsAfterSave for the
 * fire-rules.
 *
 * Optimistic locking via `expectedUpdatedAt`: if the row's current
 * updated_at doesn't match, throw ConcurrentEditError carrying the
 * current value so the admin UI can show "someone else saved this".
 *
 * @throws PostNotFoundError if no row with that id exists.
 * @throws ConcurrentEditError if expectedUpdatedAt is stale.
 * @throws DuplicateSlugError on PG 23505.
 * @throws InvalidScheduleError per createPost.
 */
export async function updatePost(
  id: string,
  input: PostInput,
  expectedUpdatedAt: Date,
  savedBy = "admin",
): Promise<SaveResult> {
  const normalised = normalisePostInput(input);
  enforceScheduleInvariant(normalised);

  const db = getDb();
  let updated: AdminPostView;
  let titleOrExcerptChanged = false;
  let embeddingShouldRefresh = false;

  try {
    updated = await db.transaction(async (tx) => {
      // Lock the row for the rest of the tx (defends against the
      // read-then-write race window).
      const existingRows = await tx
        .select({
          id: post.id,
          title: post.title,
          excerpt: post.excerpt,
          contentMd: post.contentMd,
          updatedAt: post.updatedAt,
          publishedAt: post.publishedAt,
          status: post.status,
        })
        .from(post)
        .where(eq(post.id, id))
        .for("update");

      if (existingRows.length === 0) {
        throw new PostNotFoundError(`Post "${id}" not found.`);
      }
      const existing = existingRows[0];

      // Optimistic locking. Compare millisecond timestamps; the client
      // round-trips the value as ISO and parses back. Tolerate equal-
      // by-value.
      if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConcurrentEditError(
          "Post was modified by another session.",
          existing.updatedAt,
        );
      }

      const diffSizePct = computeDiffSizePct(
        existing.contentMd,
        normalised.contentMd,
      );

      titleOrExcerptChanged =
        existing.title !== normalised.title ||
        (existing.excerpt ?? "") !== (normalised.excerpt ?? "");

      embeddingShouldRefresh = diffSizePct > EMBEDDING_REGEN_THRESHOLD_PCT;

      const wordCount = computeWordCount(normalised.contentMd);
      const readingTimeMin = readingTimeMinutes(wordCount);

      // Publish semantics on update:
      //   - draft → published: stamp publishedAt = now()
      //   - already published → published: keep original publishedAt
      //   - * → anything else: keep publishedAt as-is (history)
      const nextPublishedAt =
        normalised.status === "published" && existing.status !== "published"
          ? new Date()
          : existing.publishedAt;

      const updatedRows = await tx
        .update(post)
        .set({
          slug: normalised.slug,
          title: normalised.title,
          contentMd: normalised.contentMd,
          excerpt: normalised.excerpt,
          seoTitle: normalised.seoTitle,
          seoDescription: normalised.seoDescription,
          authorId: normalised.authorId,
          categoryId: normalised.categoryId,
          tags: normalised.tags,
          status: normalised.status,
          visibility: normalised.visibility,
          needsReview: normalised.needsReview,
          lastReviewedAt: normalised.lastReviewedAt,
          scheduledPublishAt: normalised.scheduledPublishAt,
          ogImageAlt: normalised.ogImageAlt,
          publishedAt: nextPublishedAt,
          wordCount,
          readingTimeMin,
          updatedAt: new Date(),
        })
        .where(eq(post.id, id))
        .returning();

      const row = updatedRows[0];

      await tx.insert(postRevision).values({
        postId: row.id,
        title: row.title,
        contentMd: row.contentMd,
        excerpt: row.excerpt,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        diffSizePct: diffSizePct.toFixed(2),
        savedBy,
      });

      return rowToAdminView({
        ...row,
        authorName: null,
        authorSlug: null,
        categoryName: null,
        categorySlug: null,
      });
    });
  } catch (err) {
    throw translateWriteError(err);
  }

  const sideEffects = await runSideEffectsAfterSave({
    postId: updated.id,
    titleOrExcerptChanged,
    embeddingShouldRefresh,
  });

  const refreshed = (await getAdminPostById(updated.id)) ?? updated;
  return { post: refreshed, sideEffects };
}

/**
 * Soft-delete: stamp archived_at. Public surfaces hide archived posts
 * (the /blog query filters on archived_at IS NULL). Revisions preserved.
 * Restore via restoreFromArchive() — which just clears archived_at.
 */
export async function archivePost(id: string): Promise<AdminPostView> {
  const db = getDb();
  const rows = await db
    .update(post)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(post.id, id), isNull(post.archivedAt)))
    .returning();
  if (rows.length === 0) {
    throw new PostNotFoundError(
      `Post "${id}" not found (or already archived).`,
    );
  }
  const refreshed = await getAdminPostById(id);
  if (!refreshed) throw new PostNotFoundError(`Post "${id}" disappeared.`);
  return refreshed;
}

/**
 * Inverse of archivePost. Restores by clearing archived_at. Status is
 * preserved.
 */
export async function restoreFromArchive(
  id: string,
): Promise<AdminPostView> {
  const db = getDb();
  const rows = await db
    .update(post)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(post.id, id), isNotNull(post.archivedAt)))
    .returning();
  if (rows.length === 0) {
    throw new PostNotFoundError(`Post "${id}" not found (or not archived).`);
  }
  const refreshed = await getAdminPostById(id);
  if (!refreshed) throw new PostNotFoundError(`Post "${id}" disappeared.`);
  return refreshed;
}

/**
 * Restore a prior revision's content. Creates a NEW revision row
 * reflecting the restore (so the audit trail shows when + by whom).
 * Slug + status + scheduling + visibility are NOT touched — restore is
 * a content-only operation.
 *
 * @throws RevisionNotFoundError if the revision doesn't belong to the post.
 * @throws PostNotFoundError if the post no longer exists.
 */
export async function restoreRevision(
  postId: string,
  revisionId: string,
  savedBy = "admin",
): Promise<{ post: AdminPostView; revision: RevisionView }> {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const revRows = await tx
      .select()
      .from(postRevision)
      .where(
        and(
          eq(postRevision.id, revisionId),
          eq(postRevision.postId, postId),
        ),
      )
      .limit(1);
    if (revRows.length === 0) {
      throw new RevisionNotFoundError(
        `Revision ${revisionId} not found for post ${postId}.`,
      );
    }
    const rev = revRows[0];

    const currentRows = await tx
      .select({ contentMd: post.contentMd })
      .from(post)
      .where(eq(post.id, postId))
      .for("update");
    if (currentRows.length === 0) {
      throw new PostNotFoundError(`Post "${postId}" not found.`);
    }

    const diffSizePct = computeDiffSizePct(
      currentRows[0].contentMd,
      rev.contentMd,
    );
    const wordCount = computeWordCount(rev.contentMd);
    const readingTimeMin = readingTimeMinutes(wordCount);

    const updatedRows = await tx
      .update(post)
      .set({
        title: rev.title,
        contentMd: rev.contentMd,
        excerpt: rev.excerpt,
        seoTitle: rev.seoTitle,
        seoDescription: rev.seoDescription,
        wordCount,
        readingTimeMin,
        updatedAt: new Date(),
      })
      .where(eq(post.id, postId))
      .returning();

    const newRevRows = await tx
      .insert(postRevision)
      .values({
        postId,
        title: rev.title,
        contentMd: rev.contentMd,
        excerpt: rev.excerpt,
        seoTitle: rev.seoTitle,
        seoDescription: rev.seoDescription,
        diffSizePct: diffSizePct.toFixed(2),
        savedBy: `${savedBy} (restore of ${rev.id.slice(0, 8)})`,
      })
      .returning();

    return {
      postRow: updatedRows[0],
      revision: newRevRows[0],
    };
  });

  const refreshed = await getAdminPostById(result.postRow.id);
  if (!refreshed) throw new PostNotFoundError(`Post "${postId}" disappeared.`);
  return { post: refreshed, revision: result.revision };
}

// ---------------------------------------------------------------------------
// Side effects (run AFTER tx commit)
// ---------------------------------------------------------------------------

interface SideEffectInput {
  postId: string;
  titleOrExcerptChanged: boolean;
  embeddingShouldRefresh: boolean;
}

/**
 * Fire OG regen + embedding regen as appropriate, awaiting both
 * concurrently via Promise.allSettled. Each failure is captured into
 * the SideEffectResult — the caller chooses how to surface to the UI.
 *
 * Each side effect writes back to the post row in a small dedicated
 * UPDATE (no revision, no updatedAt bump — these are derived columns).
 */
export async function runSideEffectsAfterSave(
  input: SideEffectInput,
): Promise<SideEffectResult> {
  const tasks: Array<Promise<unknown>> = [];

  let ogResult: SideEffectResult["ogRegenerated"] = "skipped";
  let ogError: string | undefined;
  let embeddingResult: SideEffectResult["embeddingRegenerated"] = "skipped";
  let embeddingError: string | undefined;

  if (input.titleOrExcerptChanged) {
    tasks.push(
      (async () => {
        try {
          await regenerateOgForPost(input.postId);
          ogResult = "ok";
        } catch (err) {
          ogResult = "failed";
          ogError = err instanceof Error ? err.message : String(err);
          console.error("[posts/og] regen failed:", ogError);
        }
      })(),
    );
  }

  if (input.embeddingShouldRefresh) {
    tasks.push(
      (async () => {
        try {
          await regenerateEmbeddingForPost(input.postId);
          embeddingResult = "ok";
        } catch (err) {
          embeddingResult = "failed";
          embeddingError =
            err instanceof EmbeddingError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          console.error("[posts/embedding] regen failed:", embeddingError);
        }
      })(),
    );
  }

  await Promise.allSettled(tasks);

  return {
    ogRegenerated: ogResult,
    ogError,
    embeddingRegenerated: embeddingResult,
    embeddingError,
  };
}

/**
 * Regenerate the OG image for a single post. Called by the side-effect
 * orchestrator above + the explicit /api/admin/posts/[id]/regenerate-og
 * button. Idempotent — re-runs are safe.
 *
 * Today: writes the stub sentinel (lib/og.ts is currently a no-op).
 * Tomorrow: writes the real R2 URL once the satori pipeline ships.
 */
export async function regenerateOgForPost(
  postId: string,
): Promise<{ ogImagePath: string; ogImageGeneratedAt: Date }> {
  const db = getDb();
  const rows = await db
    .select({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
    })
    .from(post)
    .where(eq(post.id, postId))
    .limit(1);
  if (rows.length === 0) {
    throw new PostNotFoundError(`Post "${postId}" not found.`);
  }
  const result = await generateOgImage({
    slug: rows[0].slug,
    title: rows[0].title,
    excerpt: rows[0].excerpt,
  });

  // Stub-guard: lib/og.ts currently returns "" + epoch when the satori
  // pipeline hasn't shipped yet. Writing that empty path would CLOBBER
  // the migrated WP featured image URL that today serves as the post's
  // hero + OG card. Skip the DB write when the generator is stubbed —
  // when the real renderer lands and returns a real R2 URL, this branch
  // falls through and the update runs.
  if (!result.ogImagePath || result.ogImageGeneratedAt.getTime() === 0) {
    return result;
  }

  // Update WITHOUT bumping updatedAt — OG path is derived, not
  // user-facing content. No revision row either.
  await db
    .update(post)
    .set({
      ogImagePath: result.ogImagePath,
      ogImageGeneratedAt: result.ogImageGeneratedAt,
    })
    .where(eq(post.id, postId));

  return result;
}

/**
 * Regenerate the Voyage/OpenRouter embedding for a single post. Same
 * idempotency guarantees as regenerateOgForPost.
 */
export async function regenerateEmbeddingForPost(
  postId: string,
): Promise<{ dims: number }> {
  const db = getDb();
  const rows = await db
    .select({
      title: post.title,
      excerpt: post.excerpt,
      contentMd: post.contentMd,
    })
    .from(post)
    .where(eq(post.id, postId))
    .limit(1);
  if (rows.length === 0) {
    throw new PostNotFoundError(`Post "${postId}" not found.`);
  }
  const embedding = await embedPostContent({
    title: rows[0].title,
    excerpt: rows[0].excerpt,
    contentMd: rows[0].contentMd,
  });

  // pgvector column accepts the array-of-numbers via Drizzle's vector()
  // column helper. Don't bump updatedAt (derived data).
  await db
    .update(post)
    .set({ embedding })
    .where(eq(post.id, postId));

  return { dims: embedding.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a percentage delta between two markdown blobs. Simple length
 * heuristic — exact Levenshtein would cost more than it's worth at this
 * scale. Mirrors lib/pages computeDiffSizePct exactly so revisions
 * across both surfaces use the same scale.
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

/**
 * Normalise input from the wire format into a shape the DB layer can
 * consume directly. Slug → lower kebab; null-coercion on optionals.
 * Returns a NEW object — never mutates the caller's input.
 */
function normalisePostInput(input: PostInput): {
  slug: string;
  title: string;
  contentMd: string;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  authorId: string | null;
  categoryId: string | null;
  tags: string[];
  status: PostStatus;
  visibility: PostVisibility;
  needsReview: boolean;
  lastReviewedAt: Date | null;
  scheduledPublishAt: Date | null;
  ogImageAlt: string | null;
} {
  return {
    slug: input.slug.trim().toLowerCase(),
    title: input.title.trim(),
    contentMd: input.contentMd,
    excerpt: input.excerpt ?? null,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    authorId: input.authorId ?? null,
    categoryId: input.categoryId ?? null,
    tags: input.tags ?? [],
    status: input.status,
    visibility: input.visibility ?? "listed",
    needsReview: input.needsReview ?? false,
    lastReviewedAt: input.lastReviewedAt ?? null,
    scheduledPublishAt:
      input.status === "scheduled" ? (input.scheduledPublishAt ?? null) : null,
    // Trim + truncate; reject empty string in favour of null (so
    // optional UI omission stays distinguishable from explicit empty).
    ogImageAlt: normaliseAltText(input.ogImageAlt),
  };
}

function normaliseAltText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 125);
}

/**
 * Service-layer guard: status='scheduled' requires scheduledPublishAt to
 * still be in the future at save time. The Zod schema catches this at
 * submit time, but a slow client / queued retry could push it past.
 */
function enforceScheduleInvariant(normalised: {
  status: PostStatus;
  scheduledPublishAt: Date | null;
}): void {
  if (normalised.status !== "scheduled") return;
  if (!normalised.scheduledPublishAt) {
    throw new InvalidScheduleError(
      "Scheduled posts require a scheduledPublishAt timestamp.",
    );
  }
  if (normalised.scheduledPublishAt.getTime() <= Date.now()) {
    throw new InvalidScheduleError(
      "scheduledPublishAt must be in the future at save time.",
    );
  }
}

interface PostRowForView {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentMd: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImagePath: string | null;
  ogImageGeneratedAt: Date | null;
  ogImageAlt: string | null;
  ogImageWidth: number | null;
  ogImageHeight: number | null;
  ogImageFilename: string | null;
  ogImageMimeType: string | null;
  ogImageSizeKb: number | null;
  ogImageUploadedBy: string | null;
  ogImageUploadedAt: Date | null;
  ogImageChecksum: string | null;
  ogImageR2Key: string | null;
  ogImageDeletedAt: Date | null;
  authorId: string | null;
  categoryId: string | null;
  tags: unknown;
  status: string;
  visibility: string;
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
  authorName?: string | null;
  authorSlug?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
}

function rowToAdminView(row: PostRowForView): AdminPostView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    contentMd: row.contentMd,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    ogImagePath: row.ogImagePath,
    ogImageGeneratedAt: row.ogImageGeneratedAt,
    ogImageAlt: row.ogImageAlt,
    ogImageWidth: row.ogImageWidth,
    ogImageHeight: row.ogImageHeight,
    ogImageFilename: row.ogImageFilename,
    ogImageMimeType: row.ogImageMimeType,
    ogImageSizeKb: row.ogImageSizeKb,
    ogImageUploadedBy: row.ogImageUploadedBy,
    ogImageUploadedAt: row.ogImageUploadedAt,
    ogImageChecksum: row.ogImageChecksum,
    ogImageR2Key: row.ogImageR2Key,
    ogImageDeletedAt: row.ogImageDeletedAt,
    authorId: row.authorId,
    categoryId: row.categoryId,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    status: row.status as PostStatus,
    visibility: row.visibility as PostVisibility,
    wordCount: row.wordCount,
    readingTimeMin: row.readingTimeMin,
    needsReview: row.needsReview,
    sourceWpId: row.sourceWpId,
    lastReviewedAt: row.lastReviewedAt,
    publishedAt: row.publishedAt,
    scheduledPublishAt: row.scheduledPublishAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    authorName: row.authorName ?? null,
    authorSlug: row.authorSlug ?? null,
    categoryName: row.categoryName ?? null,
    categorySlug: row.categorySlug ?? null,
  };
}

function translateWriteError(err: unknown): Error {
  if (err instanceof DuplicateSlugError) return err;
  if (err instanceof ConcurrentEditError) return err;
  if (err instanceof PostNotFoundError) return err;
  if (err instanceof RevisionNotFoundError) return err;
  if (err instanceof InvalidScheduleError) return err;

  // postgres.js exposes the SQLSTATE on `code`.
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
  ) {
    return new DuplicateSlugError("A post with that slug already exists.");
  }
  return err as Error;
}
