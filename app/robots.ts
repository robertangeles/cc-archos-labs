import type { MetadataRoute } from "next";
import { getSiteUrl } from "../lib/site-config";

// Next.js native robots.txt. Allows public site, blocks /admin and
// /api/admin (the operator UI shouldn't be indexed). Sitemap pointer
// helps Google + Bing discover all routes.
//
// AI crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.) are explicitly
// named and allowed — the goal is to be cited in AI answers, not
// blocked from training. The Disallow list for them mirrors the
// generic policy: /admin and /api/admin only.

const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "Bingbot",
  "Applebot-Extended",
  "CCBot",
  "anthropic-ai",
  "Cohere-ai",
];

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/admin/"],
      },
      // Explicit allow-list for AI crawlers. Matching `userAgent` is
      // case-sensitive per the robots.txt spec; named bots commonly
      // honour both the wildcard rule above AND their named rule —
      // we keep both for clarity.
      ...AI_CRAWLER_USER_AGENTS.map((ua) => ({
        userAgent: ua,
        allow: "/",
        disallow: ["/admin/", "/api/admin/"],
      })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
