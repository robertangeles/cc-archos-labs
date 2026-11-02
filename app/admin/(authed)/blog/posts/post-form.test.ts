import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminPostView } from "../../../../../lib/posts-admin/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

// The two pages load their data on the server; the tests only need the form around it.
const mockedPost = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../../../../lib/posts-admin", () => ({
  getAdminPostById: async () => mockedPost.current,
  listAuthorsForAdmin: async () => [],
  listCategoriesForAdmin: async () => [],
}));

import AdminBlogPostsEdit from "./[id]/page";
import AdminBlogPostsNew from "./new/page";
import { PostForm } from "./post-form";

const post = (over: Partial<AdminPostView> = {}) =>
  ({
    id: "p1",
    slug: "a-draft",
    title: "A draft",
    excerpt: null,
    contentMd: "Body.",
    seoTitle: null,
    seoDescription: null,
    ogImagePath: null,
    ogImageAlt: null,
    ogImageWidth: null,
    ogImageHeight: null,
    ogImageFilename: null,
    ogImageSizeKb: null,
    ogImageDeletedAt: null,
    authorId: null,
    categoryId: null,
    tags: [],
    status: "scheduled",
    visibility: "listed",
    needsReview: true,
    isAgentGenerated: true,
    reviewedByHumanAt: null,
    scheduledPublishAt: new Date("2026-11-03T14:00:00Z"),
    updatedAt: new Date("2026-11-02T00:00:00Z"),
    ...over,
  }) as unknown as AdminPostView;

const html = (initial: AdminPostView) => renderToStaticMarkup(createElement(PostForm, { initial, authors: [], categories: [] }));

describe("PostForm review buttons", () => {
  it("gives an agent draft that needs review one Approve button, not the two separate review buttons", () => {
    const out = html(post());
    expect(out).toContain(">Approve<");
    expect(out).not.toContain("Mark reviewed");
    expect(out).not.toContain("Mark human-reviewed");
  });

  it("keeps Approve for an agent draft that already has the byline credit but still needs review", () => {
    const out = html(post({ reviewedByHumanAt: new Date("2026-11-02T05:00:00Z") }));
    expect(out).toContain(">Approve<");
    expect(out).not.toContain("Mark reviewed");
  });

  it("offers only the byline action once an agent post is released", () => {
    expect(html(post({ needsReview: false }))).toContain("Mark human-reviewed");
    expect(html(post({ needsReview: false }))).not.toContain(">Approve<");
    expect(html(post({ needsReview: false, reviewedByHumanAt: new Date("2026-11-02T05:00:00Z") }))).toContain("Human-reviewed ✓");
  });

  it("leaves a human-written post that needs review with the plain Mark reviewed", () => {
    const out = html(post({ isAgentGenerated: false }));
    expect(out).toContain("Mark reviewed");
    expect(out).not.toContain(">Approve<");
    expect(out).not.toContain("human-reviewed");
  });
});

describe("the post pages: a way back at the bottom as well as the top", () => {
  const BACK = 'href="/admin/blog/posts">← All posts</a>';
  const links = (out: string) => out.split(BACK).length - 1;

  it("puts ← All posts under the form on the edit page, after Save", async () => {
    mockedPost.current = post();
    const out = renderToStaticMarkup(await AdminBlogPostsEdit({ params: Promise.resolve({ id: "p1" }) }));
    expect(links(out)).toBe(2);
    expect(out.lastIndexOf(BACK)).toBeGreaterThan(out.indexOf("Save changes"));
  });

  it("does the same on the new-post page", async () => {
    const out = renderToStaticMarkup(await AdminBlogPostsNew());
    expect(links(out)).toBe(2);
    expect(out.lastIndexOf(BACK)).toBeGreaterThan(out.indexOf("Create post"));
  });
});
