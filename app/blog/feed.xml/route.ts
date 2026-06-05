import { isBlogEnabled } from "../../../lib/blog/feature-flag";
import { listAllPostsForFeeds } from "../../../lib/posts";
import { getSiteSettings, getSiteUrl } from "../../../lib/site-config";

export const revalidate = 3600;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const enabled = await isBlogEnabled();
  if (!enabled) {
    return new Response("Not found", { status: 404 });
  }

  const [settings, allPosts] = await Promise.all([
    getSiteSettings(),
    listAllPostsForFeeds(),
  ]);

  const siteUrl = getSiteUrl();
  const posts = allPosts.slice(0, 22);
  const lastBuildDate =
    posts[0]?.publishedAt?.toUTCString() ?? new Date().toUTCString();

  const items = posts.map((p) => {
    const link = `${siteUrl}/blog/${xmlEscape(p.slug)}`;
    const parts = [
      "    <item>",
      `      <title>${xmlEscape(p.title)}</title>`,
      `      <link>${link}</link>`,
      `      <guid isPermaLink="true">${link}</guid>`,
    ];
    if (p.excerpt) {
      parts.push(
        `      <description><![CDATA[${p.excerpt}]]></description>`,
      );
    }
    if (p.publishedAt) {
      parts.push(`      <pubDate>${p.publishedAt.toUTCString()}</pubDate>`);
    }
    if (p.categoryName) {
      parts.push(`      <category>${xmlEscape(p.categoryName)}</category>`);
    }
    if (p.ogImagePath && !p.ogImageDeletedAt) {
      const imageUrl = p.ogImagePath.startsWith("http")
        ? p.ogImagePath
        : `${siteUrl}${p.ogImagePath}`;
      parts.push(
        `      <enclosure url="${xmlEscape(imageUrl)}" type="image/webp" length="0" />`,
      );
    }
    parts.push("    </item>");
    return parts.join("\n");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xmlEscape(settings.siteName)} — The Translation Layer</title>`,
    `    <link>${siteUrl}/blog</link>`,
    `    <description>${xmlEscape(settings.description)}</description>`,
    `    <language>en</language>`,
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `    <atom:link href="${siteUrl}/blog/feed.xml" rel="self" type="application/rss+xml" />`,
    ...items,
    "  </channel>",
    "</rss>",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}
