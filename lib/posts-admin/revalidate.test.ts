import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

const { blogPathsForPost, revalidateBlogPaths } = await import("./revalidate");

beforeEach(() => revalidatePath.mockReset());
afterEach(() => vi.restoreAllMocks());

/** Every path handed to revalidatePath, in call order. */
function calls(): string[] {
  return revalidatePath.mock.calls.map((c) => c[0] as string);
}

describe("blogPathsForPost", () => {
  it("covers the post, the index, and the category listing", () => {
    expect(
      blogPathsForPost({ slug: "my-post", categorySlug: "ai-as-strategy" }),
    ).toEqual(["/blog/my-post", "/blog", "/blog/category/ai-as-strategy"]);
  });

  it("omits the category listing when the post has no category", () => {
    expect(blogPathsForPost({ slug: "my-post", categorySlug: null })).toEqual([
      "/blog/my-post",
      "/blog",
    ]);
  });

  it("includes the old URL on a rename so the stale page is dropped", () => {
    // Without this the previous URL keeps serving a cached 200 for the whole
    // revalidate window after it has started 404ing.
    const paths = blogPathsForPost({
      slug: "new-slug",
      categorySlug: null,
      previousSlug: "old-slug",
    });
    expect(paths).toContain("/blog/old-slug");
    expect(paths).toContain("/blog/new-slug");
  });

  it("does not add a duplicate when the slug did not change", () => {
    const paths = blogPathsForPost({
      slug: "same",
      categorySlug: null,
      previousSlug: "same",
    });
    expect(paths.filter((p) => p === "/blog/same")).toHaveLength(1);
  });

  it("NEVER emits a route-pattern path", () => {
    // revalidatePath("/blog/[slug]", "page") invalidates EVERY post. Used on a
    // single-post edit it dumps the whole blog cache, which cancels the entire
    // reason /blog/[slug] moved to ISR.
    const paths = [
      ...blogPathsForPost({ slug: "a", categorySlug: "c", previousSlug: "b" }),
      ...blogPathsForPost({ slug: "x", categorySlug: null }),
    ];
    for (const p of paths) {
      expect(p).not.toContain("[");
      expect(p).not.toContain("]");
    }
  });
});

describe("revalidateBlogPaths", () => {
  it("dedupes repeated paths across a batch", () => {
    // The cron publishes up to BATCH_LIMIT=20 posts a tick and every one of
    // them wants "/blog" invalidated. Without the Set that is 20 calls.
    const batch = [
      ...blogPathsForPost({ slug: "one", categorySlug: "shared" }),
      ...blogPathsForPost({ slug: "two", categorySlug: "shared" }),
      ...blogPathsForPost({ slug: "three", categorySlug: "shared" }),
    ];
    revalidateBlogPaths(batch);

    expect(calls().filter((p) => p === "/blog")).toHaveLength(1);
    expect(calls().filter((p) => p === "/blog/category/shared")).toHaveLength(1);
    expect(calls()).toHaveLength(5); // 3 posts + /blog + 1 category
  });

  it("keeps going when one path throws, and logs it", () => {
    // These run AFTER the DB commit. A throw here means the post is already
    // live and only the cache is stale — losing the remaining invalidations
    // would make that worse, and re-raising would fail a request whose work
    // actually succeeded.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    revalidatePath.mockImplementation((p: string) => {
      if (p === "/blog") throw new Error("boom");
    });

    expect(() =>
      revalidateBlogPaths(["/blog/one", "/blog", "/blog/category/c"]),
    ).not.toThrow();

    expect(calls()).toEqual(["/blog/one", "/blog", "/blog/category/c"]);
    expect(err).toHaveBeenCalledTimes(1);
    // The failing path has to be in the log or it is undiagnosable.
    expect(JSON.stringify(err.mock.calls[0])).toContain("/blog");
  });

  it("is a no-op on an empty set", () => {
    revalidateBlogPaths([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
