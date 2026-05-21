import type { MetadataRoute } from "next";
import { isBlogEnabled } from "../lib/blog/feature-flag";
import {
  listAllCategoriesForSitemap,
  listAllPostsForFeeds,
} from "../lib/posts";
import { isPagesCmsEnabled } from "../lib/pages/feature-flag";
import { listPublishedPagesForFeeds } from "../lib/pages";
import { getSiteUrl } from "../lib/site-config";

// Next.js native sitemap. Served at /sitemap.xml. Force-dynamic so the
// feature-flag checks + DB queries run per request (cheap — indexed).
// Without this Next would prerender at build time and freeze the post
// list on whatever was in the DB at deploy.
export const dynamic = "force-dynamic";

// Bump when ANY of the genuinely-static marketing pages get a content
// edit. A per-page constant would be theatre — these change rarely and
// Google discards `lastmod` once it detects per-request "now" values
// across the whole sitemap. One curated date is honest and stable.
const STATIC_PAGES_LAST_MOD = new Date("2026-05-21");

// Must match lib/posts.ts listPosts() default page size — otherwise the
// sitemap submits paginated URLs that don't exist (e.g. ?page=27 when the
// index only has 26 pages).
const POSTS_PER_PAGE = 10;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const entries: MetadataRoute.Sitemap = [
    {
      url: base,
      lastModified: STATIC_PAGES_LAST_MOD,
      changeFrequency: "monthly",
      priority: 1.0,
    },
    {
      url: `${base}/about`,
      lastModified: STATIC_PAGES_LAST_MOD,
      changeFrequency: "yearly",
      priority: 0.8,
    },
    {
      url: `${base}/ai-readiness-assessment`,
      lastModified: STATIC_PAGES_LAST_MOD,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${base}/tools/ai-readiness`,
      lastModified: STATIC_PAGES_LAST_MOD,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${base}/contact`,
      lastModified: STATIC_PAGES_LAST_MOD,
      changeFrequency: "yearly",
      priority: 0.7,
    },
  ];

  // CMS-managed pages (currently /privacy, /terms; future long-form
  // pages get added here automatically when published via /admin/pages).
  // Note: there are NO hardcoded /privacy or /terms entries above —
  // they're sourced from the CMS table to avoid duplicates.
  const pagesEnabled = await isPagesCmsEnabled();
  if (pagesEnabled) {
    const cmsPages = await listPublishedPagesForFeeds();
    for (const p of cmsPages) {
      entries.push({
        url: `${base}/${p.slug}`,
        lastModified: p.lastReviewedAt ?? p.updatedAt,
        changeFrequency: "yearly",
        priority: 0.4,
      });
    }
  }

  const blogEnabled = await isBlogEnabled();
  if (!blogEnabled) return entries;

  const [posts, categoryStats] = await Promise.all([
    listAllPostsForFeeds(),
    listAllCategoriesForSitemap(),
  ]);

  // /blog index — lastmod = most recent post's lastReviewedAt/publishedAt.
  // Falls back to STATIC_PAGES_LAST_MOD when posts is empty.
  const blogIndexLastMod =
    posts[0]?.lastReviewedAt ?? posts[0]?.publishedAt ?? STATIC_PAGES_LAST_MOD;
  entries.push({
    url: `${base}/blog`,
    lastModified: blogIndexLastMod,
    changeFrequency: "weekly",
    priority: 0.9,
  });

  // Paginated index — /blog?page=2..N. Self-canonical (the matching
  // generateMetadata change in app/blog/page.tsx makes the canonical
  // include the page param). Helps Google discover old posts that the
  // unpaginated /blog doesn't surface.
  const totalBlogPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  for (let n = 2; n <= totalBlogPages; n++) {
    entries.push({
      url: `${base}/blog?page=${n}`,
      lastModified: blogIndexLastMod,
      changeFrequency: "monthly",
      priority: 0.4,
    });
  }

  // Categories — lastmod + changefreq reflect the category's most recent
  // post, not a hardcoded "weekly" lie. Dormant categories report yearly.
  const now = Date.now();
  for (const c of categoryStats) {
    const ageDays = (now - c.mostRecentPublishedAt.getTime()) / 86_400_000;
    const cf: "weekly" | "monthly" | "yearly" =
      ageDays < 30 ? "weekly" : ageDays < 180 ? "monthly" : "yearly";
    entries.push({
      url: `${base}/blog/category/${c.slug}`,
      lastModified: c.mostRecentPublishedAt,
      changeFrequency: cf,
      priority: 0.6,
    });
    const totalCatPages = Math.max(1, Math.ceil(c.postCount / POSTS_PER_PAGE));
    for (let n = 2; n <= totalCatPages; n++) {
      entries.push({
        url: `${base}/blog/category/${c.slug}?page=${n}`,
        lastModified: c.mostRecentPublishedAt,
        changeFrequency: cf,
        priority: 0.3,
      });
    }
  }

  // Posts — including the image sitemap extension where a featured image
  // exists and has not been soft-deleted. The image URL follows the same
  // absolute-vs-relative pattern used by lib/structured-data.ts.
  for (const p of posts) {
    const lm = p.lastReviewedAt ?? p.publishedAt;
    const ageDays = Math.max(0, (now - lm.getTime()) / 86_400_000);
    const entry: MetadataRoute.Sitemap[number] = {
      url: `${base}/blog/${p.slug}`,
      lastModified: lm,
      changeFrequency: ageDays < 30 ? "weekly" : "monthly",
      priority: ageDays < 60 ? 0.8 : 0.6,
    };
    if (p.ogImagePath && !p.ogImageDeletedAt) {
      const imageUrl = p.ogImagePath.startsWith("http")
        ? p.ogImagePath
        : `${base}${p.ogImagePath}`;
      entry.images = [imageUrl];
    }
    entries.push(entry);
  }

  return entries;
}
