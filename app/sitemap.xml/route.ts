import { isBlogEnabled } from "../../lib/blog/feature-flag";
import {
  listAllCategoriesForSitemap,
  listAllPostsForFeeds,
} from "../../lib/posts";
import { isPagesCmsEnabled } from "../../lib/pages/feature-flag";
import { listPublishedPagesForFeeds } from "../../lib/pages";
import { getSiteUrl } from "../../lib/site-config";

// ISR: rebuild the sitemap at most once per hour. Google polls sitemaps
// every few days, so 1h staleness is invisible to crawlers but eliminates
// the cold-start + DB-query window that was failing Googlebot's fetch
// budget when the route was force-dynamic.
//
// Replaces the prior app/sitemap.ts MetadataRoute.Sitemap export. That API
// hardcodes child-element order as <loc><image:image><lastmod>... which
// violates the sitemap.org XSD sequence (loc, lastmod, changefreq, priority,
// then image:image). We hand-build the XML here so the output matches the
// strict schema order.
export const revalidate = 3600;

const STATIC_PAGES_LAST_MOD = new Date("2026-05-21");

// Must match lib/posts.ts listPosts() default page size — otherwise the
// sitemap submits paginated URLs that don't exist.
const POSTS_PER_PAGE = 10;

type ChangeFreq =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

type UrlEntry = {
  loc: string;
  lastmod: Date;
  changefreq: ChangeFreq;
  priority: number;
  imageLoc?: string;
};

// Escape the five XML entities. <loc> is element content, so only &, <, >
// are strictly required, but escaping all five keeps the function safe to
// reuse for attributes if the schema ever extends.
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderEntry(e: UrlEntry): string {
  const parts = [
    "  <url>",
    `    <loc>${xmlEscape(e.loc)}</loc>`,
    `    <lastmod>${e.lastmod.toISOString()}</lastmod>`,
    `    <changefreq>${e.changefreq}</changefreq>`,
    `    <priority>${e.priority}</priority>`,
  ];
  if (e.imageLoc) {
    parts.push(
      "    <image:image>",
      `      <image:loc>${xmlEscape(e.imageLoc)}</image:loc>`,
      "    </image:image>",
    );
  }
  parts.push("  </url>");
  return parts.join("\n");
}

async function buildEntries(): Promise<UrlEntry[]> {
  const base = getSiteUrl();
  const entries: UrlEntry[] = [
    {
      loc: base,
      lastmod: STATIC_PAGES_LAST_MOD,
      changefreq: "monthly",
      priority: 1.0,
    },
    {
      loc: `${base}/about`,
      lastmod: STATIC_PAGES_LAST_MOD,
      changefreq: "yearly",
      priority: 0.8,
    },
    {
      loc: `${base}/ai-readiness-assessment`,
      lastmod: STATIC_PAGES_LAST_MOD,
      changefreq: "monthly",
      priority: 0.9,
    },
    {
      loc: `${base}/tools/ai-readiness`,
      lastmod: STATIC_PAGES_LAST_MOD,
      changefreq: "monthly",
      priority: 0.9,
    },
    {
      loc: `${base}/contact`,
      lastmod: STATIC_PAGES_LAST_MOD,
      changefreq: "yearly",
      priority: 0.7,
    },
  ];

  const pagesEnabled = await isPagesCmsEnabled();
  if (pagesEnabled) {
    const cmsPages = await listPublishedPagesForFeeds();
    for (const p of cmsPages) {
      entries.push({
        loc: `${base}/${p.slug}`,
        lastmod: p.lastReviewedAt ?? p.updatedAt,
        changefreq: "yearly",
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

  const blogIndexLastMod =
    posts[0]?.lastReviewedAt ?? posts[0]?.publishedAt ?? STATIC_PAGES_LAST_MOD;
  entries.push({
    loc: `${base}/blog`,
    lastmod: blogIndexLastMod,
    changefreq: "weekly",
    priority: 0.9,
  });

  const totalBlogPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  for (let n = 2; n <= totalBlogPages; n++) {
    entries.push({
      loc: `${base}/blog?page=${n}`,
      lastmod: blogIndexLastMod,
      changefreq: "monthly",
      priority: 0.4,
    });
  }

  const now = Date.now();
  for (const c of categoryStats) {
    const ageDays = (now - c.mostRecentPublishedAt.getTime()) / 86_400_000;
    const cf: ChangeFreq =
      ageDays < 30 ? "weekly" : ageDays < 180 ? "monthly" : "yearly";
    entries.push({
      loc: `${base}/blog/category/${c.slug}`,
      lastmod: c.mostRecentPublishedAt,
      changefreq: cf,
      priority: 0.6,
    });
    const totalCatPages = Math.max(1, Math.ceil(c.postCount / POSTS_PER_PAGE));
    for (let n = 2; n <= totalCatPages; n++) {
      entries.push({
        loc: `${base}/blog/category/${c.slug}?page=${n}`,
        lastmod: c.mostRecentPublishedAt,
        changefreq: cf,
        priority: 0.3,
      });
    }
  }

  for (const p of posts) {
    const lm = p.lastReviewedAt ?? p.publishedAt;
    const ageDays = Math.max(0, (now - lm.getTime()) / 86_400_000);
    const entry: UrlEntry = {
      loc: `${base}/blog/${p.slug}`,
      lastmod: lm,
      changefreq: ageDays < 30 ? "weekly" : "monthly",
      priority: ageDays < 60 ? 0.8 : 0.6,
    };
    if (p.ogImagePath && !p.ogImageDeletedAt) {
      entry.imageLoc = p.ogImagePath.startsWith("http")
        ? p.ogImagePath
        : `${base}${p.ogImagePath}`;
    }
    entries.push(entry);
  }

  return entries;
}

export async function GET(): Promise<Response> {
  const entries = await buildEntries();
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...entries.map(renderEntry),
    "</urlset>",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
