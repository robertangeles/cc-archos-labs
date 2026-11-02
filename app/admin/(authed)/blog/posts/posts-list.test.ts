import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminPostView } from "../../../../../lib/posts-admin/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { PostsList } from "./posts-list";

// Only the fields the row reads; the rest of AdminPostView is not rendered here.
const post = (over: Partial<AdminPostView> = {}) =>
  ({
    id: "p1",
    slug: "a-draft",
    title: "A draft",
    status: "scheduled",
    needsReview: true,
    isAgentGenerated: true,
    categoryName: "AI News",
    publishedAt: null,
    scheduledPublishAt: new Date("2026-11-03T14:00:00Z"),
    archivedAt: null,
    updatedAt: new Date("2026-11-02T00:00:00Z"),
    ...over,
  }) as unknown as AdminPostView;

const html = (posts: AdminPostView[]) =>
  renderToStaticMarkup(
    createElement(PostsList, { initial: posts, totalCount: posts.length, page: 1, totalPages: 1, currentStatus: "all", currentSearch: "" }),
  );

describe("PostsList row actions", () => {
  it("gives each live row a Preview that opens the reader view in a new tab, next to Edit", () => {
    const out = html([post()]);
    expect(out).toMatch(/<a [^>]*href="\/admin\/blog\/posts\/p1\/preview"[^>]*target="_blank"[^>]*>Preview<\/a>/);
    expect(out).toMatch(/<a [^>]*href="\/admin\/blog\/posts\/p1\/preview"[^>]*rel="noopener noreferrer"/);
    expect(out.indexOf(">Preview<")).toBeLessThan(out.indexOf(">Edit<"));
  });

  it("offers no Preview for an archived post, which would only open a notice to restore it", () => {
    const out = html([post({ archivedAt: new Date("2026-11-01T00:00:00Z") })]);
    expect(out).toContain(">Edit<");
    expect(out).not.toContain("/preview");
  });
});
