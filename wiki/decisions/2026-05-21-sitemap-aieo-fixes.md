---
title: Sitemap AIEO fixes — May 2026
category: decision
updated: 2026-05-21
created: 2026-05-21
related: [[deployment-architecture]], [[2026-05-20-translation-layer-public-render]], [[2026-05-20-posts-admin-phase-d-backend]], [[index]]
---

Audit-driven rewrite of `app/sitemap.ts` after Phase D posts admin shipped. The
DB had the image metadata; none of it was reaching Google Image search or the
AI crawlers. Plus six smaller honesty fixes flagged by the audit.

## Context

The Posts Admin Phase D backend ([[2026-05-20-posts-admin-phase-d-backend]])
landed `og_image_path`, `og_image_alt`, `og_image_width`, `og_image_height` on
`post` an hour before this audit. The sitemap was still emitting the same
URL-only entries it shipped with in [[2026-05-20-translation-layer-public-render]].

The audit also surfaced longer-standing issues: `lastModified: new Date()` on
every static entry (Google discounts a sitemap once it detects per-request
"now" timestamps across all routes), missing `/about`, missing CMS pages
(`/privacy`, `/terms`, `/consulting`), missing paginated blog/category URLs,
and category `changefreq` hardcoded to `weekly` regardless of activity.

## D1 — Image sitemap as the highest-priority fix

The DB infrastructure was already there. Adding the image extension was a
projection extension on `listAllPostsForFeeds()` plus `entry.images = [url]` on
each post entry. Next 16's `MetadataRoute.Sitemap` supports `images: string[]`
natively, which renders as `<image:image><image:loc>` with the correct
`xmlns:image` declaration. URL normalisation mirrors the `lib/structured-data.ts`
pattern (absolute URL pass-through; relative path prepended with site origin).

Posts soft-deleted via `og_image_deleted_at` are excluded from the image
extension (still listed as a `<url>` — only the image entry is suppressed).

## D2 — Static-page `lastmod` strategy

Rejected: per-page constants (one for `/`, one for `/about`, etc). Defensible
but verbose, and any "I'll bump it when I edit" rule rots fast.

Picked: a single `STATIC_PAGES_LAST_MOD` constant. Bump it when any
marketing/landing page is materially edited. Google rarely uses lastmod for
re-crawling marketing pages; the win is *stopping the lie*, not encoding
per-page accuracy.

Privacy/terms specifically moved OUT of the static block — they're CMS-served
via `app/[...slug]/page.tsx` and their `updatedAt` lives in the `page` table.
Pulling them from the CMS list avoids a contradiction where the hardcoded
sitemap entry says one date and the page's rendered metadata says another.

## D3 — Paginated `?page=N` requires matching canonicals

Plain emission of `/blog?page=2..N` to the sitemap would contradict the
existing canonical (`<link rel="canonical" href="/blog">` on every paginated
URL). Google would receive a "submit /blog?page=N" signal alongside a
"consolidate to /blog" signal — contradictions get discarded.

Fix paired in the same PR: `generateMetadata({ searchParams })` on both
`app/blog/page.tsx` and `app/blog/category/[slug]/page.tsx` builds the
canonical with `?page=N` when on a paginated URL. The sitemap and the
rendered HTML now agree.

Page size constant lives in `app/sitemap.ts` and must stay equal to
`lib/posts.ts` `listPosts` default (10). Out-of-sync would emit paginated
URLs that 404 or duplicate the last page.

## D4 — Category `changefreq` from data, not from convention

Replaced the hardcoded `weekly` with a per-category aggregate
(`listAllCategoriesForSitemap()`): `count(post.id)` for pagination depth,
`max(post.published_at)` for `lastmod`. `changefreq` derives from the age
of the most-recent post:

| age of most-recent post | changefreq |
|-------------------------|------------|
| < 30 days               | weekly     |
| 30–180 days             | monthly    |
| 180+ days               | yearly     |

Same logic applied to category-paginated URLs.

## D5 — postgres.js + drizzle aggregate type coercion

The first attempt at `listAllCategoriesForSitemap()` typed the aggregate
result via `sql<Date>` and `sql<number>` template tags. That's a TypeScript
assertion only — postgres.js returns aggregate results (`max(timestamp)`,
`count()::int`) as strings unless an explicit driver-side parser is
registered.

Caught at runtime in dev: `TypeError: c.mostRecentPublishedAt.getTime is not
a function`. Fixed by widening the SQL result type to `Date | string | null`
and coercing at the `.map()` step with `new Date(r.mostRecentPublishedAt)`
and `Number(r.postCount)`. Lesson: never trust the `sql<T>` template type
across aggregate boundaries — always coerce explicitly when you'd call
methods on the result.

## What didn't change

- The blog feature flag still gates the entire post + category section.
  Sitemap returns just the static + CMS-page block when blog is dark.
- `lib/posts.ts:listAllPostsForFeeds` and `listAllPostsForLlmsFull` keep
  serving `/llms.txt` and `/llms-full.txt`. The image fields were added
  as required (non-optional) on `PostSitemapEntry`; llms-txt consumers
  ignore them; their unit tests got the three new null fields appended
  to the fixtures.
- `robots.txt` still points to `/sitemap.xml`. No change to AI-crawler
  allow-list or `/admin` disallow.

## Verification

- `pnpm tsc --noEmit` clean.
- `pnpm lint` clean (the one pre-existing warning in `tmp/walkthrough.mjs`
  is not in scope).
- `pnpm test` 527/527 pass.
- `pnpm build` succeeds — `/sitemap.xml` registered as dynamic (ƒ).
- Local `curl http://localhost:3007/sitemap.xml`: 314 `<url>` entries — 5
  static + 3 CMS + 1 `/blog` + 25 `/blog?page=2..26` + 4 categories + 23
  category-paginated + 253 posts. 253 `<image:loc>` entries (every post
  with a non-soft-deleted featured image).
- Canonical agreement verified for `/blog`, `/blog?page=2`, and
  `/blog/category/<slug>?page=2` — each declares itself canonical, matching
  the corresponding sitemap entry.

## Next steps (operational, no code)

Items 42 + 43 of [[backlog]] become unblocked once this lands:
- Submit `https://archoslabs.xyz/sitemap.xml` to Google Search Console.
- Submit same URL to Bing Webmaster Tools.

Wait until this PR is merged + deployed before submitting — submitting a
broken sitemap and then fixing it teaches GSC to distrust the property.
