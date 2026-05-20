import type { MetadataRoute } from "next";
import { isBlogEnabled } from "../lib/blog/feature-flag";
import { listAllCategories, listAllPostsForFeeds } from "../lib/posts";
import { getSiteUrl } from "../lib/site-config";

// Next.js native sitemap. Served at /sitemap.xml. Regenerated on every
// request. Includes /blog index, every published+listed post, and every
// category index — but only when the blog feature flag is enabled.

// Without this, Next prerenders the sitemap at build time and the post
// entries freeze on whatever was in the DB at deploy. Force dynamic so
// the flag check + post list query run per-request (cheap — single
// indexed query).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = [
    {
      url: base,
      lastModified,
      changeFrequency: "monthly",
      priority: 1.0,
    },
    {
      url: `${base}/ai-readiness-assessment`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${base}/contact`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const enabled = await isBlogEnabled();
  if (!enabled) return entries;

  const [posts, categories] = await Promise.all([
    listAllPostsForFeeds(),
    listAllCategories(),
  ]);

  entries.push({
    url: `${base}/blog`,
    lastModified: posts[0]?.lastReviewedAt ?? posts[0]?.publishedAt ?? lastModified,
    changeFrequency: "weekly",
    priority: 0.9,
  });

  for (const c of categories) {
    entries.push({
      url: `${base}/blog/category/${c.slug}`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  for (const p of posts) {
    const lm = p.lastReviewedAt ?? p.publishedAt;
    // Higher priority for the 30-most-recent — Google uses this hint
    // to prioritise crawl budget.
    const ageDays = Math.max(
      0,
      (Date.now() - lm.getTime()) / (1000 * 60 * 60 * 24),
    );
    const priority = ageDays < 60 ? 0.8 : 0.6;
    entries.push({
      url: `${base}/blog/${p.slug}`,
      lastModified: lm,
      changeFrequency: ageDays < 30 ? "weekly" : "monthly",
      priority,
    });
  }

  return entries;
}
