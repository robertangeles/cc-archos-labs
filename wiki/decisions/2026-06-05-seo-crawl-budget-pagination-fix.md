---
title: SEO crawl budget fix — remove pagination from sitemap
category: decision
created: 2026-06-05
updated: 2026-06-05
related: [[2026-05-21-sitemap-aieo-fixes]], [[2026-05-24-sitemap-cold-start-cacheable]], [[translation-layer]]
---

Remove pagination URLs from sitemap and add noindex to paginated pages to fix Google crawl budget allocation.

## Problem

GSC showed 320 pages discovered, only 28 indexed. All 290 non-indexed pages had status "Discovered – currently not indexed" with Last crawled = 1970-01-01 (never crawled by Google). The sitemap included ~48 pagination URLs (`/blog?page=N`, `/blog/category/{slug}?page=N`) competing for crawl budget on a young site (~2 weeks in GSC).

## Root cause

Not content quality — Google never read the pages. Crawl budget for a new domain was spread across 314 URLs, and Google only allocated enough budget to crawl ~30. Pagination URLs consumed some of those slots (e.g. `?page=8`, `?page=16` were indexed while actual blog posts sat uncrawled).

## Changes (PR #131)

1. Removed blog and category pagination loops from `app/sitemap.xml/route.ts`
2. Added `robots: { index: false, follow: true }` on paginated pages (page > 1) in `app/blog/page.tsx` and `app/blog/category/[slug]/page.tsx`
3. Added `/consulting` to sitemap static entries (was missing)
4. Bumped `STATIC_PAGES_LAST_MOD` to 2026-06-05
5. Cleared `needsReview` flag on 120 posts via DB update — audit confirmed zero template placeholders, all 300+ words

## Expected outcome

Sitemap drops from ~314 to ~218 URLs. Google's crawl budget concentrates on indexable content. Indexed page count should climb over 2-4 weeks.

## Follow-up actions

- Resubmit sitemap in GSC after deploy
- Manually request indexing for `/`, `/consulting`, `/about`, `/blog`, `/tools/ai-readiness` via URL Inspection
- Monitor GSC "Pages" report weekly through June
