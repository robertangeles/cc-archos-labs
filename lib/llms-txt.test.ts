import { describe, expect, it } from "vitest";
import { buildLlmsFullTxt, buildLlmsTxt } from "./llms-txt";
import { SITE_DEFAULTS, type SiteSettings } from "./site-config-shared";
import type { PostSitemapEntry } from "./posts";

const settings: SiteSettings = {
  ...SITE_DEFAULTS,
  siteName: "Archos Labs",
  tagline: "Built by practitioners.",
  description: "Practitioner-led AI consulting.",
};

const siteUrl = "https://archoslabs.xyz";

const posts: PostSitemapEntry[] = [
  {
    slug: "alpha",
    title: "Alpha",
    excerpt: "Alpha excerpt.",
    publishedAt: new Date("2026-01-01"),
    lastReviewedAt: new Date("2026-03-01"),
    categoryName: "AI as Strategy",
  },
  {
    slug: "beta",
    title: "Beta",
    excerpt: null,
    publishedAt: new Date("2026-02-01"),
    lastReviewedAt: null,
    categoryName: "Data as a Decision Infrastructure",
  },
];

describe("buildLlmsTxt", () => {
  it("includes site name + tagline + description + post list", () => {
    const out = buildLlmsTxt({ settings, siteUrl, posts, topN: 20 });
    expect(out).toContain("# Archos Labs");
    expect(out).toContain("> Built by practitioners.");
    expect(out).toContain("Practitioner-led AI consulting.");
    expect(out).toContain("[Alpha](https://archoslabs.xyz/blog/alpha)");
    expect(out).toContain("[Beta](https://archoslabs.xyz/blog/beta)");
    expect(out).toContain("Alpha excerpt.");
  });
  it("truncates to topN when more posts exist", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      slug: `p${i}`,
      title: `Post ${i}`,
      excerpt: null,
      publishedAt: new Date(),
      lastReviewedAt: null,
      categoryName: null,
    }));
    const out = buildLlmsTxt({ settings, siteUrl, posts: many, topN: 5 });
    expect(out).toContain("[Post 0]");
    expect(out).toContain("[Post 4]");
    expect(out).not.toContain("[Post 5]");
    expect(out).toContain("Full corpus");
  });
});

describe("buildLlmsFullTxt", () => {
  it("emits one section per post with body", () => {
    const out = buildLlmsFullTxt({
      settings,
      siteUrl,
      posts: posts.map((p) => ({ ...p, contentMd: `body for ${p.slug}` })),
    });
    expect(out).toContain("# Archos Labs — Full corpus");
    expect(out).toContain("# Alpha");
    expect(out).toContain("body for alpha");
    expect(out).toContain("# Beta");
    expect(out).toContain("body for beta");
  });
});
