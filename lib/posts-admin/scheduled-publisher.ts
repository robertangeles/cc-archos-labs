import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { category, post, postRevision } from "../db/schema";
import { pingIndexNow } from "../indexnow";
import { getSiteUrl } from "../site-config";
import { blogPathsForPost, revalidateBlogPaths } from "./revalidate";

// Service backing /api/cron/process-scheduled-posts.
//
// Render Cron POSTs the route every minute. The route handler verifies
// the Bearer secret + writes the cron_heartbeat row, then calls into
// this module for the actual poll-and-publish work.
//
// Concurrency model: the SELECT ... FOR UPDATE SKIP LOCKED locks each
// candidate row for the rest of the transaction. If two cron workers
// run concurrently (Render restart overlap, manual invocation during a
// scheduled run), each one picks up a non-overlapping slice — same
// pattern as lib/scheduler.ts (booking emails).
//
// Concurrent-edit race: the per-row UPDATE includes
// `WHERE status='scheduled'` so an admin save that flipped the row to
// 'draft' (or back to 'published' manually) in the gap between SELECT
// and UPDATE matches zero rows. The cron silently skips it. Last-
// write-wins is acceptable here — the admin's intent overrides the
// schedule.

const BATCH_LIMIT = 20;

export interface PublishResultDetail {
  id: string;
  outcome: "published" | "raced" | "failed";
  detail?: string;
}

export interface PublishResult {
  ok: boolean;
  processed: number;
  published: number;
  raced: number;
  failed: number;
  details: PublishResultDetail[];
}

/**
 * Poll for posts whose scheduled time has arrived and flip them to
 * 'published'. Writes a revision row per successful publish so the
 * audit trail shows "auto-published by scheduler".
 *
 * Idempotent: a row that another worker has already flipped is a no-op
 * (the WHERE clause matches zero rows). The atomic UPDATE also defends
 * against admin saves that happened in between the SELECT and UPDATE
 * windows.
 */
export async function publishScheduledPosts(
  now: Date = new Date(),
): Promise<PublishResult> {
  const db = getDb();

  // Stage 1: pull a locked batch of due-now scheduled rows. The partial
  // index `post_due_for_publish_idx` serves this query. `slug` is
  // selected so the post-batch IndexNow ping can address each
  // newly-public URL by its full path.
  const dueRows = await db.transaction(async (tx) => {
    return tx
      .select({
        id: post.id,
        slug: post.slug,
        title: post.title,
        contentMd: post.contentMd,
        excerpt: post.excerpt,
        seoTitle: post.seoTitle,
        seoDescription: post.seoDescription,
        scheduledPublishAt: post.scheduledPublishAt,
      })
      .from(post)
      .where(
        and(
          eq(post.status, "scheduled"),
          lte(post.scheduledPublishAt, now),
          // Blog writer agent gate: an agent-written post does not go live
          // until a human clears needs_review (the existing "Mark reviewed"
          // action in the admin editor, which also writes an audit revision).
          //
          // The conjunction is deliberate. needs_review alone is a GENERAL
          // editorial flag — the WordPress migration set it on 120 posts and
          // any admin can set it on any post — so gating on it by itself
          // would silently stop a human's own flagged-and-scheduled post from
          // ever publishing, with nothing in the logs to explain it. Scoping
          // to is_agent_generated leaves human-authored behaviour untouched.
          //
          // Still served by the partial index post_due_for_publish_idx
          // (WHERE status = 'scheduled'); the extra predicate is a post-scan
          // filter, verified by EXPLAIN.
          sql`NOT (${post.isAgentGenerated} AND ${post.needsReview})`,
        ),
      )
      .orderBy(sql`${post.scheduledPublishAt} ASC`)
      .limit(BATCH_LIMIT)
      .for("update", { skipLocked: true });
  });

  if (dueRows.length === 0) {
    return {
      ok: true,
      processed: 0,
      published: 0,
      raced: 0,
      failed: 0,
      details: [],
    };
  }

  // Stage 2: for each row, atomically flip status='published' guarded
  // by `WHERE status='scheduled'`. Write a revision row so the audit
  // trail shows when + by whom (savedBy='scheduler-cron').
  const details: PublishResultDetail[] = [];
  const publishedSlugs: string[] = [];
  let published = 0;
  let raced = 0;
  let failed = 0;

  for (const row of dueRows) {
    try {
      const result = await db.transaction(async (tx) => {
        const updated = await tx
          .update(post)
          .set({
            status: "published",
            publishedAt: now,
            scheduledPublishAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(post.id, row.id),
              eq(post.status, "scheduled"),
            ),
          )
          .returning({ id: post.id });

        if (updated.length === 0) {
          // Admin flipped the row in the race window — skip silently.
          return { raced: true } as const;
        }

        // Revision row marks the auto-publish. diffSizePct=0 because no
        // content changed; the savedBy column carries the trail.
        await tx.insert(postRevision).values({
          postId: row.id,
          title: row.title,
          contentMd: row.contentMd,
          excerpt: row.excerpt,
          seoTitle: row.seoTitle,
          seoDescription: row.seoDescription,
          diffSizePct: "0.00",
          savedBy: "scheduler-cron",
        });

        return { raced: false } as const;
      });

      if (result.raced) {
        raced++;
        details.push({
          id: row.id,
          outcome: "raced",
          detail: "Row no longer in 'scheduled' status — admin moved it.",
        });
      } else {
        published++;
        publishedSlugs.push(row.slug);
        details.push({ id: row.id, outcome: "published" });
      }
    } catch (err) {
      failed++;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[posts/scheduled-publisher] failed for ${row.id}:`,
        detail,
      );
      details.push({ id: row.id, outcome: "failed", detail });
    }
  }

  // Batch-ping IndexNow for everything we just flipped to public. One
  // POST regardless of batch size — fits the global endpoint's
  // urlList[] shape. Cron may publish 1-20 posts per tick, so coalescing
  // saves request count when a clustered schedule fires.
  if (publishedSlugs.length > 0) {
    const siteUrl = getSiteUrl();
    void pingIndexNow(
      publishedSlugs.map((s) => `${siteUrl}/blog/${s}`),
    ).catch(() => {});

    // Drop the ISR cache for everything that just went live.
    //
    // This is the load-bearing publish path, not an edge case: the blog agent
    // creates its posts with status='scheduled', so they NEVER travel through
    // createPost's direct-publish branch. Every automated post in the site
    // reaches the public surface through exactly this function.
    //
    // The category is fetched here rather than joined into the Stage 1 query
    // on purpose. That query holds FOR UPDATE ... SKIP LOCKED, and in Postgres
    // a join under FOR UPDATE locks rows in the joined table too — which would
    // put category rows under a row lock during every publish tick and let a
    // locked category silently skip a post. One extra unlocked read after the
    // commit is far cheaper than that blast radius.
    const publishedRows = await db
      .select({ slug: post.slug, categorySlug: category.slug })
      .from(post)
      .leftJoin(category, eq(post.categoryId, category.id))
      .where(inArray(post.slug, publishedSlugs));

    revalidateBlogPaths(
      publishedRows.flatMap((r) =>
        blogPathsForPost({ slug: r.slug, categorySlug: r.categorySlug }),
      ),
    );
  }

  return {
    ok: failed === 0,
    processed: dueRows.length,
    published,
    raced,
    failed,
    details,
  };
}
