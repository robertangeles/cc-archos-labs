import "server-only";
import { revalidatePath } from "next/cache";

// Cache invalidation for the public blog surface.
//
// Two rules live here, and both exist because getting them wrong is silent.
//
// 1. EXACT PATHS ONLY. `revalidatePath("/blog/[slug]", "page")` is the
//    route-pattern form and invalidates EVERY post. Used on a single-post
//    edit it dumps the whole blog cache, which cancels out the entire reason
//    /blog/[slug] moved to ISR. Nothing here ever passes a bracketed segment,
//    and revalidate.test.ts asserts it.
//
// 2. FAILURE IS LOGGED, NEVER SWALLOWED, NEVER FATAL. These calls run AFTER
//    the DB commit. If one throws, the post is already live and only the cache
//    is stale — so re-raising would fail a request whose work actually
//    succeeded, and on the cron path would re-enter a partially-published
//    batch. A bare `catch {}` is equally wrong: this repo already has one bug
//    hidden that way (see the prune-runs FK trap). Catch, log with the path,
//    carry on.
//
// Note that /blog and /blog/category/[slug] are still force-dynamic — they
// read searchParams for ?page= — so revalidating them is currently a no-op.
// The calls stay because they cost nothing, they document intent, and they
// make this correct the moment those routes can take ISR.

/** Public paths affected by a change to one post. */
export function blogPathsForPost(args: {
  slug: string;
  categorySlug?: string | null;
  /** A rename leaves the old URL cached and 404-ing until it expires. */
  previousSlug?: string | null;
}): string[] {
  const paths = [`/blog/${args.slug}`, "/blog"];
  if (args.categorySlug) paths.push(`/blog/category/${args.categorySlug}`);
  if (args.previousSlug && args.previousSlug !== args.slug) {
    paths.push(`/blog/${args.previousSlug}`);
  }
  return paths;
}

/**
 * Revalidate a set of paths, deduped, each failure isolated.
 *
 * Dedup matters on the cron path: BATCH_LIMIT is 20 and the job runs every
 * minute, so a naive per-post loop would invalidate "/blog" twenty times a tick.
 */
export function revalidateBlogPaths(paths: Iterable<string>): void {
  for (const path of new Set(paths)) {
    try {
      revalidatePath(path);
    } catch (err) {
      console.error("[revalidate] failed", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
