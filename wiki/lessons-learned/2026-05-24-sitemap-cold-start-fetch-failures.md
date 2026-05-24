---
title: "Lesson: a dynamic sitemap on a cold-starting origin will fail Googlebot's fetch budget"
category: lessons-learned
created: 2026-05-24
updated: 2026-05-24
related: [[2026-05-24-sitemap-cold-start-cacheable]], [[2026-05-21-sitemap-aieo-fixes]], [[deployment-architecture]]
---

## Problem

The sitemap shipped with `export const dynamic = "force-dynamic"` and a defending comment that said: *"Without this Next would prerender at build time and freeze the post list on whatever was in the DB at deploy."* That reasoning was wrong on two counts.

First, the choice between "rebuild every request" and "build once at deploy" is a false dichotomy. ISR (`export const revalidate = N`) rebuilds on-demand after a TTL — which is the freshness model a sitemap actually needs.

Second, `force-dynamic` on a route that runs DB queries means **every Googlebot fetch races a cold start**. Render's hobby/starter tier idles aggressively. Sitemap fetches arrive infrequently (Google polls every few days), so they're disproportionately likely to hit a cold instance. The route did two parallel DB queries (`listAllPostsForFeeds`, `listAllCategoriesForSitemap`) plus two sequential feature-flag checks. On a warm instance from my IP this took ~1.6s. On a cold start with a cold DB connection pool, it could exceed Googlebot's fetch budget — and there's no observability into when that happens because GSC just reports `Couldn't fetch` with empty `Last read`.

Bing read the file fine. Bingbot has a different (often longer) fetch timeout posture, and Bing's webmaster tools also surface different error states. The asymmetry was the tell: it wasn't a content problem (we already validated the XML and namespaces locally), it was a fetch-attempt problem specifically against Google's stricter budget.

## Fix

`app/sitemap.ts` deleted. Replaced with `app/sitemap.xml/route.ts` — a custom route handler with:
- `export const revalidate = 3600` (ISR at the Next layer)
- Hand-built XML body with `xmlEscape()` helper and child elements in canonical sitemap.org XSD order (`loc`, `lastmod`, `changefreq`, `priority`, then `image:image` last per the image-extension schema)
- Returns `Content-Type: application/xml; charset=utf-8`

`next.config.ts` gained a `headers()` rule:
```ts
{ source: "/sitemap.xml",
  headers: [{ key: "Cache-Control",
              value: "public, s-maxage=3600, stale-while-revalidate=86400" }] }
```

The CDN header is load-bearing in tandem with ISR: ISR caches in-process (resets on every Render instance restart, which is exactly when Googlebot is most likely to hit a cold origin); `s-maxage` caches at Cloudflare's edge so Googlebot's fetch is served from the CDN even when Render is cold or restarting.

Full reasoning in [[2026-05-24-sitemap-cold-start-cacheable]].

## Rule

**Routes that serve infrequent, eventually-consistent traffic to bots must be edge-cacheable. `force-dynamic` is the wrong default for any route a search engine or AI crawler fetches.**

The category includes: `sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt`, RSS/Atom feeds, structured-data endpoints, any OG-image generation route, any `*.well-known` file. None of these need per-request freshness. All of them are likely to be fetched by crawlers on long intervals, which means each fetch is disproportionately likely to hit a cold origin.

### How to apply

- Default to `export const revalidate = N` (ISR) for any route that builds a public, deterministic response from DB. Pick the N that matches the staleness budget for the consumer (sitemaps: 3600s; OG images: 86400s; feed XML: 900s).
- Pair ISR with a CDN `Cache-Control` header via `next.config.ts` `headers()` — `public, s-maxage=N, stale-while-revalidate=M`. The ISR cache lives at the app instance; the CDN cache lives at the edge. They protect against different failure modes (DB latency vs origin cold start), and you want both.
- Only use `export const dynamic = "force-dynamic"` when the response genuinely varies per request (auth-gated content, per-user data, request-time A/B splits). For public read-only content driven by DB state, it is almost always wrong.

### Diagnostic rule for "search engine X can't fetch but search engine Y can"

When two crawlers report different success rates on the same public URL, the cause is more likely **timing-related** (one has a stricter fetch budget than the other) than **content-related** (one parses stricter than the other). Confirm with:
1. Real user-agent fetches from outside your local network (Googlebot UA, Bingbot UA, plain curl control) to check whether Cloudflare or the origin returns different responses per UA.
2. Time-to-first-byte under cold-origin conditions vs warm. If TTFB exceeds 5s cold, the route is in the danger zone for Googlebot.
3. The asymmetric crawler's webmaster tool's URL inspection / live test — that's the single fastest way to get the crawler's *actual* fetch verdict instead of inferring it.

Only after timing is ruled out should you start chasing content-level theories (XML schema strictness, MIME types, encoding, namespace order).

### Anti-pattern to avoid

Don't bump Render's instance size as a fix for crawler fetch failures. It treats the symptom (cold start is too slow) instead of the cause (an eventually-consistent endpoint shouldn't be hitting origin at all). Edge caching makes the speed of the underlying route irrelevant to the crawler — that's the right shape of fix.
