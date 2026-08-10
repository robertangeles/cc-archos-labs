---
title: A row committed as publishable before its side effects run will ship broken and get orphaned by the retry
category: synthesis
created: 2026-08-10
updated: 2026-08-10
related: [[2026-07-12-seo-crawl-not-indexed-hygiene]], [[2026-07-25-no-fabricated-experience]]
---

Two live blog posts had no featured image. The cause was not the image pipeline — it was that `createPost` committed the post as publishable *before* `attachIllustration` ran, so a crash in between shipped a broken post AND caused the sweeper's retry to write a duplicate.

## Problem

`/blog/where-ai-sits-determines-what-you-measure` rendered with no hero. Investigation found a second one, and the two were 2 of 22 posts in the feed.

The obvious hypotheses were all wrong:

- **"The illustration step didn't exist yet."** It landed `2241919` on 2026-07-26; both posts are August.
- **"The image was soft-deleted."** Every image column was NULL — `og_image_path`, `og_image_deleted_at`, `og_image_filename`, `og_image_generated_at`, `og_image_alt`. Nothing was ever attached.
- **"`attachIllustration` failed."** It cannot fail silently. It has two separate try blocks precisely so an R2 outage falls through to the house asset, and it swallows a failure of that too. Reaching the end of it means an image is attached one way or another.

The correlation that cracked it, across every published agent post:

| has `content_plan_item` | has image | count |
| --- | --- | --- |
| no | no | 2 |
| yes | yes | 42 |

44 of 44, no exceptions. The image-less posts were exactly the posts with no queue item pointing at them.

`finish()` ran in this order:

```
createPost({ status: "scheduled", needsReview: false, scheduledPublishAt })  ← COMMITS
attachIllustration(...)
releaseItem(item.id, "drafted", { postId })                                  ← claims the pointer
```

A run that died between the first and third line left:

1. A post already committed as `scheduled` with `needsReview: false` — it auto-published at its slot with a blank featured slot.
2. A `content_plan_item` still `running`. Its 15-minute lock (`LOCK_TTL_MS`) expired, `sweepStaleLocks` reclaimed it, `attempts + 1`.
3. A retry that wrote a **new post with a different slug**, which took the `post_id` pointer — orphaning the first post, live and untracked.

That is one bug with two symptoms. The near-duplicate pair
(`six-week-ai-readiness-sprint-small-business` vs `...-no-it-team`, published 17 hours apart, 5,871 vs 7,358 chars, near-identical excerpts) was never a content-planning mistake. It was the same crash. `attempts = 3` on the surviving item is the fingerprint.

## Fix

Hold the post unpublishable until it is complete:

```ts
createPost({ ..., needsReview: true })      // held
await attachIllustration(...)
await getDb().update(postTable)
  .set({ needsReview: false })              // released only once complete
  .where(eq(postTable.id, post.id));
await releaseItem(...)
```

The publisher already had the brake — `NOT (is_agent_generated AND needs_review)`. Nothing new was needed; the flag simply had to be set in the order the invariant requires. A successful run behaves identically to before. A crashed run now leaves a post that cannot publish and surfaces in the admin as needing review.

Guarded by `lib/blog-agent/run.publish-hold.test.ts`, which asserts the *ordering* of the four calls, not just the end state. Verified failing before the fix (all 3 cases) and passing after.

Live cleanup: 301 for the duplicate (matching the existing precedent in `next.config.ts`), archive it out of the feed, and `scripts/backfill-orphan-post-image.mjs` for the survivor.

## Rules

- **A row that is publishable the moment it is committed must be committed complete.** If a side effect after the insert is required for the row to be correct — an image, a derived field, an upload — insert it in a held state and release the hold after. Ordering is the fix, not a try/catch.
- **Defensive error handling downstream does not protect you from a crash upstream.** `attachIllustration` was carefully written so no failure could leave a post unillustrated, and it worked exactly as designed. It just never ran. Hardening a function says nothing about whether it is reached.
- **When a queue retries by reclaiming an expired lock, ask what the abandoned attempt already wrote.** A retry that assumes the previous attempt wrote nothing will duplicate whatever it did write. `releaseItem` records `post_id` at the END, so anything created before the crash has no pointer and no owner.
- **A post with no `content_plan_item` is an orphan, and that is a queryable invariant.** Worth a periodic check: `SELECT ... FROM post p WHERE p.is_agent_generated AND NOT EXISTS (SELECT 1 FROM content_plan_item i WHERE i.post_id = p.id)`.
- **Absolute URLs stored in the DB are environment-specific, and the env vars that build them come from different places.** `DATABASE_URL` is typically set on the command line to target PROD while `NEXT_PUBLIC_SITE_URL` still comes from `--env-file=.env.local` and says localhost. Any script writing an absolute URL must refuse when the two disagree — `backfill-orphan-post-image.mjs` does.
