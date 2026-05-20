import { describe, expect, it } from "vitest";
import {
  articleSchema,
  breadcrumbSchema,
  jsonLdScript,
  organizationSchema,
  personSchema,
} from "./structured-data";
import { SITE_DEFAULTS, type SiteSettings } from "./site-config-shared";
import type { PublishedPostView } from "./posts";

const settings: SiteSettings = {
  ...SITE_DEFAULTS,
  siteName: "Archos Labs",
  tagline: "Built by practitioners.",
  description: "Practitioner-led AI consulting.",
  linkedinUrl: "https://www.linkedin.com/company/archos-labs",
  twitterHandle: "archoslabs",
  modellingRoomUrl: "https://www.linkedin.com/newsletters/the-modelling-room",
  ogImageUrl: "/og-image.png",
  founderName: "Rob Angeles",
  founderLinkedinUrl: "https://www.linkedin.com/in/robertangeles",
};

const siteUrl = "https://archoslabs.xyz";

const post: PublishedPostView = {
  id: "post-uuid",
  slug: "the-translation-layer",
  title: "The Translation Layer",
  excerpt: "Why most AI programs fail.",
  contentMd: "# Body\n\n## Section",
  seoTitle: null,
  seoDescription: null,
  ogImagePath: "https://pub-x.r2.dev/blog/the-translation-layer/featured.png",
  ogImageGeneratedAt: new Date("2026-05-19T00:00:00Z"),
  tags: ["governance", "data"],
  wordCount: 720,
  readingTimeMin: 4,
  needsReview: false,
  publishedAt: new Date("2026-04-01T00:00:00Z"),
  lastReviewedAt: new Date("2026-05-10T00:00:00Z"),
  authorSlug: "robangeles",
  authorName: "Rob Angeles",
  authorBioMd: "",
  authorPhotoUrl: null,
  authorLinkedinUrl: "https://www.linkedin.com/in/robertangeles",
  categorySlug: "ai-as-strategy",
  categoryName: "AI as Strategy",
  categoryDescription: null,
};

describe("organizationSchema", () => {
  it("emits Organization with sameAs from settings", () => {
    const ld = organizationSchema(settings, siteUrl);
    expect(ld["@type"]).toBe("Organization");
    expect(ld.name).toBe("Archos Labs");
    expect(ld.url).toBe(siteUrl);
    expect(Array.isArray(ld.sameAs)).toBe(true);
    expect((ld.sameAs as string[]).length).toBeGreaterThan(0);
  });
});

describe("personSchema", () => {
  it("includes LinkedIn + modelling room in sameAs", () => {
    const ld = personSchema(
      "Rob Angeles",
      "https://www.linkedin.com/in/robertangeles",
      null,
      siteUrl,
      settings,
    );
    expect(ld["@type"]).toBe("Person");
    expect(ld.name).toBe("Rob Angeles");
    expect((ld.sameAs as string[]).length).toBeGreaterThan(0);
  });
});

describe("breadcrumbSchema", () => {
  it("emits 3-item breadcrumb when category present", () => {
    const ld = breadcrumbSchema(post, siteUrl);
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0].name).toBe("Blog");
    expect(items[1].name).toBe("AI as Strategy");
    expect(items[2].name).toBe("The Translation Layer");
  });
  it("emits 2-item breadcrumb when category missing", () => {
    const ld = breadcrumbSchema(
      { ...post, categorySlug: null, categoryName: null },
      siteUrl,
    );
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
  });
});

describe("articleSchema", () => {
  it("emits Article with author Person + publisher Organization", () => {
    const ld = articleSchema(post, siteUrl, settings);
    expect(ld["@type"]).toBe("Article");
    expect(ld.headline).toBe("The Translation Layer");
    expect((ld.author as Record<string, unknown>).name).toBe("Rob Angeles");
    expect((ld.publisher as Record<string, unknown>).name).toBe("Archos Labs");
    expect(ld.dateModified).toBe("2026-05-10T00:00:00.000Z");
    expect(ld.datePublished).toBe("2026-04-01T00:00:00.000Z");
    expect(ld.wordCount).toBe(720);
    expect(ld.keywords).toBe("governance, data");
  });
});

describe("jsonLdScript", () => {
  it("escapes </script> defensively", () => {
    const html = jsonLdScript({
      headline: "</script><script>alert(1)</script>",
    });
    expect(html.toLowerCase()).not.toContain("</script>");
  });
});
