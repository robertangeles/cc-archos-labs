import { describe, expect, it, vi } from "vitest";

// buildPageMetadata decides <title>, canonical, and the whole OG + Twitter
// block for EVERY page on the site, and until this suite it had no direct
// coverage at all — only normalizeTwitterHandle below was tested. It shipped a
// live regression as a result: the 2026-07-12 brand-strip left the homepage
// <title> with no brand, because Next.js applies title.template to descendant
// segments only and app/page.tsx shares the root segment with app/layout.tsx.
//
// getSiteSettings is wrapped in React cache(), so settings are stubbed ONCE
// here rather than varied per test — mutating them between cases would fight
// the memoisation rather than test anything real.

const SETTINGS = {
  siteName: "Archos Labs",
  tagline: "Built by practitioners.",
  description: "Site level description.",
  founderName: "Rob Angeles",
  founderLinkedinUrl: "",
  modellingRoomUrl: "",
  ogImageUrl: "/opengraph-image",
  twitterHandle: "archoslabsxyz",
  linkedinUrl: "",
};

vi.mock("./db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ value: SETTINGS }] }),
      }),
    }),
  }),
}));

const { buildPageMetadata, normalizeTwitterHandle } = await import("./site-config");

const BRAND = " — Archos Labs";

/** Count non-overlapping occurrences of the brand suffix. */
function brandCount(s: string): number {
  return s.split(BRAND).length - 1;
}

describe("normalizeTwitterHandle", () => {
  it("returns a bare handle unchanged", () => {
    expect(normalizeTwitterHandle("archoslabsxyz")).toBe("archoslabsxyz");
  });

  it("strips a leading @", () => {
    expect(normalizeTwitterHandle("@archoslabsxyz")).toBe("archoslabsxyz");
  });

  it("strips an https://x.com/ profile URL", () => {
    // The exact stored value that caused the production bug — site_setting
    // held the full profile URL, so `@${stored}` rendered as
    // `@https://x.com/archoslabsxyz` and X ignored it.
    expect(normalizeTwitterHandle("https://x.com/archoslabsxyz")).toBe(
      "archoslabsxyz",
    );
  });

  it("strips an https://twitter.com/ profile URL", () => {
    expect(normalizeTwitterHandle("https://twitter.com/archoslabsxyz")).toBe(
      "archoslabsxyz",
    );
  });

  it("strips http:// and www. prefixes", () => {
    expect(normalizeTwitterHandle("http://www.x.com/archoslabsxyz")).toBe(
      "archoslabsxyz",
    );
  });

  it("strips a trailing slash on a profile URL", () => {
    expect(normalizeTwitterHandle("https://x.com/archoslabsxyz/")).toBe(
      "archoslabsxyz",
    );
  });

  it("drops a query string on a profile URL", () => {
    expect(
      normalizeTwitterHandle("https://x.com/archoslabsxyz?utm_source=foo"),
    ).toBe("archoslabsxyz");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTwitterHandle("  archoslabsxyz  ")).toBe("archoslabsxyz");
  });

  it("returns empty string when input is empty", () => {
    expect(normalizeTwitterHandle("")).toBe("");
  });

  it("returns empty string when input is whitespace only", () => {
    expect(normalizeTwitterHandle("   ")).toBe("");
  });

  it("collapses repeated leading @", () => {
    expect(normalizeTwitterHandle("@@archoslabsxyz")).toBe("archoslabsxyz");
  });
});

describe("buildPageMetadata — title", () => {
  it("emits a bare string for a child route, letting the layout template brand it", async () => {
    const meta = await buildPageMetadata({ title: "Contact", path: "/contact" });
    // A plain string means "run me through the ancestor template".
    expect(meta.title).toBe("Contact");
  });

  it("emits default + template when no title is given (the root layout call)", async () => {
    const meta = await buildPageMetadata({});
    expect(meta.title).toEqual({
      default: "Archos Labs — Built by practitioners.",
      template: "%s — Archos Labs",
    });
  });

  it("emits title.absolute when absoluteTitle is set (the homepage escape)", async () => {
    const meta = await buildPageMetadata({
      title: "Your Fractional Data Team",
      absoluteTitle: true,
      path: "/",
    });
    expect(meta.title).toEqual({
      absolute: `Your Fractional Data Team${BRAND}`,
    });
  });

  it("REGRESSION: absolute title carries the brand exactly once, never zero or twice", async () => {
    // Zero was the live bug. Twice was the bug the 2026-07-12 fix removed.
    // Both directions are guarded here so neither can come back silently.
    const meta = await buildPageMetadata({
      title: "Your Fractional Data Team",
      absoluteTitle: true,
      path: "/",
    });
    const absolute = (meta.title as { absolute: string }).absolute;
    expect(brandCount(absolute)).toBe(1);
  });

  it("REGRESSION: a brand-free child title stays brand-free at this layer", async () => {
    // The layout template adds the brand once. If buildPageMetadata also added
    // it here, every child page would read "Contact — Archos Labs — Archos Labs".
    const meta = await buildPageMetadata({ title: "Contact", path: "/contact" });
    expect(brandCount(meta.title as string)).toBe(0);
  });

  it("brands og:title and twitter:title even for child routes", async () => {
    // OG has no template mechanism, so the brand must be baked in there.
    const meta = await buildPageMetadata({ title: "Contact", path: "/contact" });
    expect(meta.openGraph?.title).toBe(`Contact${BRAND}`);
    expect(meta.twitter?.title).toBe(`Contact${BRAND}`);
    expect(brandCount(meta.openGraph?.title as string)).toBe(1);
  });
});

describe("buildPageMetadata — canonical", () => {
  it("builds an absolute canonical from a leading-slash path", async () => {
    const meta = await buildPageMetadata({ path: "/consulting" });
    expect(meta.alternates?.canonical).toBe("https://archoslabs.xyz/consulting");
  });

  it("tolerates a path with no leading slash", async () => {
    const meta = await buildPageMetadata({ path: "consulting" });
    expect(meta.alternates?.canonical).toBe("https://archoslabs.xyz/consulting");
  });

  it("falls back to the site root when no path is given", async () => {
    const meta = await buildPageMetadata({});
    expect(meta.alternates?.canonical).toBe("https://archoslabs.xyz");
  });
});

describe("buildPageMetadata — article dates", () => {
  const PUBLISHED = "2026-05-18T23:00:00.000Z";
  const MODIFIED = "2026-07-01T10:00:00.000Z";

  it("emits both published and modified time for an article", async () => {
    const meta = await buildPageMetadata({
      title: "A post",
      path: "/blog/a-post",
      ogType: "article",
      publishedISO: PUBLISHED,
      lastUpdatedISO: MODIFIED,
    });
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.type).toBe("article");
    expect(og.publishedTime).toBe(PUBLISHED);
    expect(og.modifiedTime).toBe(MODIFIED);
  });

  it("emits publishedTime even when there is no modified date", async () => {
    // The two are gated independently — a post published and never reviewed
    // still needs its publish date.
    const meta = await buildPageMetadata({
      title: "A post",
      ogType: "article",
      publishedISO: PUBLISHED,
    });
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.publishedTime).toBe(PUBLISHED);
    expect(og.modifiedTime).toBeUndefined();
  });

  it("omits publishedTime when not supplied", async () => {
    const meta = await buildPageMetadata({
      title: "A page",
      ogType: "article",
      lastUpdatedISO: MODIFIED,
    });
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.publishedTime).toBeUndefined();
    expect(og.modifiedTime).toBe(MODIFIED);
  });

  it("never emits article dates on a website-type page", async () => {
    const meta = await buildPageMetadata({
      title: "Contact",
      publishedISO: PUBLISHED,
      lastUpdatedISO: MODIFIED,
    });
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.type).toBe("website");
    expect(og.publishedTime).toBeUndefined();
    expect(og.modifiedTime).toBeUndefined();
  });

  it("carries articleSection alongside the modified time", async () => {
    const meta = await buildPageMetadata({
      title: "A post",
      ogType: "article",
      lastUpdatedISO: MODIFIED,
      articleSection: "Human-Centered Transformation",
    });
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.section).toBe("Human-Centered Transformation");
  });
});

describe("buildPageMetadata — images", () => {
  it("normalises a site-relative default image to an absolute URL", async () => {
    const meta = await buildPageMetadata({ path: "/" });
    const images = meta.openGraph?.images as Array<Record<string, unknown>>;
    expect(images[0].url).toBe("https://archoslabs.xyz/opengraph-image");
  });

  it("stamps 1200x630 on the site default image", async () => {
    const meta = await buildPageMetadata({ path: "/" });
    const images = meta.openGraph?.images as Array<Record<string, unknown>>;
    expect(images[0].width).toBe(1200);
    expect(images[0].height).toBe(630);
  });

  it("passes an absolute per-page image through untouched", async () => {
    const url = "https://cdn.example.com/blog/hero.png";
    const meta = await buildPageMetadata({ image: url });
    const images = meta.openGraph?.images as Array<Record<string, unknown>>;
    expect(images[0].url).toBe(url);
  });

  it("omits dimensions on a per-page image when none are supplied", async () => {
    // Otherwise scrapers render the real image stretched into a 1200x630 box.
    const meta = await buildPageMetadata({
      image: "https://cdn.example.com/blog/hero.png",
    });
    const images = meta.openGraph?.images as Array<Record<string, unknown>>;
    expect(images[0].width).toBeUndefined();
    expect(images[0].height).toBeUndefined();
  });

  it("uses supplied per-page dimensions when they exist", async () => {
    const meta = await buildPageMetadata({
      image: "https://cdn.example.com/blog/hero.png",
      imageWidth: 1600,
      imageHeight: 900,
      imageAlt: "A described image",
    });
    const images = meta.openGraph?.images as Array<Record<string, unknown>>;
    expect(images[0].width).toBe(1600);
    expect(images[0].height).toBe(900);
    expect(images[0].alt).toBe("A described image");
  });
});

describe("buildPageMetadata — twitter", () => {
  it("emits creator and site as bare handles with a single @", async () => {
    // The FAT audit claimed these were full URLs. They are not, and this
    // pins the shape so they cannot become URLs by accident.
    const meta = await buildPageMetadata({ path: "/" });
    // Metadata["twitter"] is a discriminated union keyed on `card`, so the
    // whole block is read through one cast rather than narrowing per field.
    const twitter = meta.twitter as Record<string, unknown>;
    expect(twitter.card).toBe("summary_large_image");
    expect(twitter.creator).toBe("@archoslabsxyz");
    expect(twitter.site).toBe("@archoslabsxyz");
  });
});
