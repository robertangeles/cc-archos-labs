---
title: Sitemap — ISR + custom XML route over force-dynamic MetadataRoute
category: decision
created: 2026-05-24
updated: 2026-05-24
related: [[2026-05-21-sitemap-aieo-fixes]], [[deployment-architecture]], [[2026-05-24-sitemap-cold-start-fetch-failures]]
---

Replaced `app/sitemap.ts` (Next's `MetadataRoute.Sitemap` API + `dynamic = "force-dynamic"`) with `app/sitemap.xml/route.ts` (hand-built XML + `revalidate = 3600`) + a CDN `Cache-Control` header in `next.config.ts`. Two problems solved in the same change: cold-start fetch failures and non-canonical child-element order.

## Context

Google Search Console showed `Couldn't fetch` on `https://archoslabs.xyz/sitemap.xml` with empty `Last read`. Bing read the same file without issue. URL Inspection in GSC confirmed Google had no record of the URL at all (`URL is unknown to Google`, all Crawl fields `N/A`) — i.e. Google had not yet successfully retrieved a single byte.

Local diagnostics ruled out the obvious failure modes:
- HTTP 200 to Googlebot UA, Googlebot-Image UA, Bingbot UA, and a plain curl control — Cloudflare was not challenging at the edge from this IP.
- Body was valid XML, namespaces declared (`xmlns="…/sitemap/0.9"`, `xmlns:image="…/sitemap-image/1.1"`).
- 314 URLs, 253 image entries, 101 KB total — orders of magnitude under Google's 50,000-URL / 50 MB limits.
- No raw `&`, no oversized URLs, no redirect chains.

What was wrong:
1. **`dynamic = "force-dynamic"`** meant every request rebuilt from DB (2 parallel queries: `listAllPostsForFeeds` + `listAllCategoriesForSitemap`) plus 2 sequential feature-flag checks. The response headers showed `cache-control: max-age=0, must-revalidate` and `cf-cache-status: DYNAMIC` — Cloudflare was passing every fetch through to Render origin. On a cold start (Render starter-tier idles aggressively) Googlebot's fetch budget could expire before the response came back.
2. **Child elements inside `<url>` were emitted in the wrong order.** Next's `MetadataRoute.Sitemap` hardcodes `<loc><image:image><lastmod>...` which violates the sitemap.org XSD `xs:sequence` (`loc`, `lastmod`, `changefreq`, `priority`, then the image extension). Real-world parsers are usually lenient about ordering but the schema is strict, and pairing this fix with the cache fix removed a second possible cause from the same PR.

## Decision

`export const revalidate = 3600` on a custom route handler at `app/sitemap.xml/route.ts`, plus `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` set via `next.config.ts` `headers()`. The XML body is built by hand in canonical XSD order.

### Why ISR is the right freshness model here

Sitemaps need eventual consistency, not real-time. Google polls a typical sitemap every few days. A 1-hour staleness budget is invisible to crawlers and eliminates the cold-start + DB-query window completely. The earlier comment defending `force-dynamic` ("Without this Next would prerender at build time and freeze the post list on whatever was in the DB at deploy") was incorrect: ISR rebuilds on-demand after the TTL, which is exactly the freshness model a sitemap needs. `force-dynamic` only ever made sense if the sitemap content changed per-request — it doesn't.

### Why both ISR *and* a CDN `Cache-Control` header

Defence in depth. ISR caches the response at the Next layer (in-process / per-instance on Render). The `s-maxage=3600, stale-while-revalidate=86400` directive tells Cloudflare to cache at the edge for 1h and serve stale up to 24h while revalidating. Even on a Render cold start, Cloudflare serves the cached body so Googlebot never waits on origin. Without the CDN header, the Next ISR cache resets on every Render instance restart — exactly the moment a Googlebot fetch is most likely to hit a cold origin.

### Why hand-build the XML instead of staying on `MetadataRoute.Sitemap`

Next's metadata API gives no hook to reorder child elements. The hardcoded `<loc><image:image><lastmod>...` order violates the strict XSD sequence. Replacing the route is ~40 LOC of explicit XML serialization with an `xmlEscape` helper. Trade-off accepted: we lose the typed `MetadataRoute.Sitemap` API; we gain control over the output bytes. Image URLs from R2 currently have no query strings (so no `&` to escape in practice), but the escape function is correct regardless.

## Rejected alternatives

- **Increase Render plan / pre-warm** — fixes the symptom this week, costs money forever, doesn't help if the route is slow for any reason other than cold start. Caching makes the speed of the underlying route irrelevant to Googlebot.
- **Sitemap index split (`/sitemap_index.xml` → `/sitemap-pages.xml` + `/sitemap-posts.xml`)** — only matters at >50,000 URLs (we have 314). Premature.
- **Move image entries to their own sitemap file** — Google accepts inline `image:image` extensions; splitting them adds maintenance with no proven benefit at our scale.
- **Snapshot tests asserting element order + escaping** — considered, deferred. The custom route is short enough to review by eye, and the only true regression risk is a future edit reordering the `parts` array in `renderEntry()`. Worth adding if the route ever grows or if a slug with special characters lands.

## What changes for the next person

- Editing the sitemap = editing one file (`app/sitemap.xml/route.ts`). Element order is explicit. Add a new field by adding a line to `renderEntry()` in the canonical XSD position.
- The CDN cache has a 1-hour worst-case staleness. A post published in the admin will not appear in the sitemap until the next ISR rebuild + the next CDN revalidation window. If you need a faster signal to Google for a specific URL, IndexNow ([[2026-05-21-indexnow]]) is the push channel — though Google doesn't subscribe, Bing/Yandex do.
- If you remove `app/sitemap.xml/route.ts`, do not re-add `app/sitemap.ts` to replace it without also restoring `next.config.ts`'s `headers()` rule for `/sitemap.xml` — and re-acquiring the element-order problem.
