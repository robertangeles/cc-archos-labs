import { describe, expect, it } from "vitest";
import {
  articleSchema,
  breadcrumbSchema,
  jsonLdScript,
  organizationSchema,
  personSchema,
} from "./structured-data";
import { SCHEMA_IDS } from "./schema-graph";
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
  ogImageDeletedAt: null,
  ogImageAlt: "Diagram of the Translation Layer architecture.",
  ogImageWidth: 1200,
  ogImageHeight: 630,
  tags: ["governance", "data"],
  wordCount: 720,
  readingTimeMin: 4,
  needsReview: false,
  isAgentGenerated: false,
  reviewedByHumanAt: null,
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
  it("emits Article with an inline author and a publisher reference", () => {
    const ld = articleSchema(post, siteUrl, settings);
    expect(ld["@type"]).toBe("Article");
    expect(ld.headline).toBe("The Translation Layer");
    // "Rob Angeles" is not an author identity this codebase can vouch for —
    // see personIdForAuthor — so the Article keeps an inline Person rather
    // than claiming an @id it has no basis for.
    expect((ld.author as Record<string, unknown>).name).toBe("Rob Angeles");
    expect((ld.author as Record<string, unknown>)["@id"]).toBeUndefined();
    // Publisher is a bare reference now. Re-declaring the Organization here is
    // what made Google resolve two of them.
    expect(ld.publisher).toEqual({ "@id": SCHEMA_IDS.org });
    expect(ld.dateModified).toBe("2026-05-10T00:00:00.000Z");
    expect(ld.datePublished).toBe("2026-04-01T00:00:00.000Z");
    expect(ld.wordCount).toBe(720);
    expect(ld.keywords).toBe("governance, data");
  });

  it("references #metis when the author is the agent", () => {
    // The live case: one author row, renamed to "Metis" by the seed backfill,
    // used by every agent post. This is the only author the graph can name.
    const ld = articleSchema(
      { ...post, authorName: "Metis" },
      siteUrl,
      settings,
    );
    expect(ld.author).toEqual({ "@id": SCHEMA_IDS.metis });
  });

  it("NEVER attributes a post to the founder", () => {
    // Promoting a post to #rob-angeles is a review-status decision keyed on
    // reviewed_by_human_at, not an author-name match. Until that column exists
    // no code path may make this claim — it would be a false authorship
    // statement in machine-readable form.
    for (const name of ["Rob Angeles", "rob angeles", "Metis", "Someone Else"]) {
      const ld = articleSchema({ ...post, authorName: name }, siteUrl, settings);
      expect(JSON.stringify(ld.author)).not.toContain(SCHEMA_IDS.person);
    }
  });
});

describe("articleSchema — human-reviewed byline", () => {
  const agentPost = { ...post, authorName: "Metis", isAgentGenerated: true };

  it("promotes the founder to author AND editor once a human reviewed it", () => {
    const ld = articleSchema(
      { ...agentPost, reviewedByHumanAt: new Date("2026-07-28T00:00:00Z") },
      siteUrl,
      settings,
    );
    expect(ld.author).toEqual({ "@id": SCHEMA_IDS.person });
    expect(ld.editor).toEqual({ "@id": SCHEMA_IDS.person });
    // Metis is demoted, not erased. Hiding the AI's involvement would be the
    // dishonest version of this feature.
    expect(ld.contributor).toEqual({ "@id": SCHEMA_IDS.metis });
  });

  it("leaves an UNREVIEWED agent post attributed to Metis with no editor", () => {
    // The default state of the three posts published every day.
    const ld = articleSchema(
      { ...agentPost, reviewedByHumanAt: null },
      siteUrl,
      settings,
    );
    expect(ld.author).toEqual({ "@id": SCHEMA_IDS.metis });
    expect(ld.editor).toBeUndefined();
    expect(ld.contributor).toBeUndefined();
  });

  it("NEVER claims the founder reviewed a human-written post", () => {
    // The ~120 WP-migrated posts read authorName "Metis" only because the seed
    // backfill collapsed all authors into one row. Marking one reviewed must
    // not manufacture a "Researched by Metis / Reviewed by Rob" claim over
    // writing Metis never touched.
    const ld = articleSchema(
      {
        ...post,
        isAgentGenerated: false,
        reviewedByHumanAt: new Date("2026-07-28T00:00:00Z"),
      },
      siteUrl,
      settings,
    );
    expect(ld.editor).toBeUndefined();
    expect(ld.contributor).toBeUndefined();
    expect(JSON.stringify(ld.author)).not.toContain(SCHEMA_IDS.person);
  });

  it("keeps the publisher reference identical in both branches", () => {
    for (const reviewedByHumanAt of [null, new Date()]) {
      const ld = articleSchema(
        { ...agentPost, reviewedByHumanAt },
        siteUrl,
        settings,
      );
      expect(ld.publisher).toEqual({ "@id": SCHEMA_IDS.org });
    }
  });
});

describe("personSchema — identity resolution", () => {
  it("stamps #metis on the agent, case-insensitively", () => {
    for (const name of ["Metis", "metis", "  METIS  "]) {
      const ld = personSchema(name, null, null, siteUrl, settings);
      expect(ld["@id"]).toBe(SCHEMA_IDS.metis);
    }
  });

  it("leaves an unrecognised author anonymous rather than guessing", () => {
    const ld = personSchema("Someone Else", null, null, siteUrl, settings);
    expect(ld["@id"]).toBeUndefined();
    expect(ld.name).toBe("Someone Else");
  });

  it("points worksFor at the org node instead of inlining it", () => {
    const ld = personSchema("Metis", null, null, siteUrl, settings);
    expect(ld.worksFor).toEqual({ "@id": SCHEMA_IDS.org });
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
