---
title: "Crawled – currently not indexed" is mostly domain trust, but hygiene bugs feed it
category: synthesis
created: 2026-07-12
updated: 2026-07-12
related: [[2026-06-05-seo-crawl-budget-pagination-fix]], [[2026-05-21-sitemap-aieo-fixes]], [[translation-layer]]
---

GSC "Crawled – currently not indexed" on a young domain is dominated by domain-authority/content-quality (Google's discretion, not a code error) — but several latent code gremlins were actively adding noise, and those we can fix.

## Problem
archoslabs.xyz (~2-month-old domain) showed ~20 blog + category URLs stuck at "Crawled – currently not indexed", plateaued flat since mid-June. Root cause of the *bucket* is young-domain trust + AI-authored content cadence (fix = backlinks + manual index requests + depth, not code). But a codebase audit found real hygiene bugs that were feeding Google confusing/thin signals.

## Fix (shipped, branch `fix/seo-crawl-cleanup`)
- **Soft-404 → real 404** on out-of-range pagination. `/blog/category/[slug]?page=99` and `/blog?page=99` served HTTP 200 with an empty "No posts" body — exactly what Google files as "Crawled – currently not indexed". Added `if (page > totalPages) notFound()`. Both routes; the index had been missed when the category page was first fixed.
- **Title brand-doubling.** The root layout sets `title.template: "%s — Archos Labs"`; `buildPageMetadata`'s `effectiveTitle` *also* appends the brand for OG/Twitter. Home/About/Consulting embedded "Archos Labs" in their own title strings → `<title>` and social cards rendered the brand twice. Stripped the embedded brand (titles must be brand-free).
- **force-dynamic → ISR** on `/llms.txt` + `/llms-full.txt` (matched `feed.xml`). They set an `s-maxage` edge header but `force-dynamic` defeated origin caching and hit the DB every crawl.
- **Layout JSON-LD** serialized via `jsonLdScript()` not bare `JSON.stringify` — an admin field containing `</script>` would otherwise break every page's structured data + is an injection vector.
- **Article JSON-LD** image gated on `!ogImageDeletedAt` (OG meta/feed/sitemap already did) — stops emitting URLs to soft-deleted images that 404 on Google's rich-result fetch.
- **RSS excerpt** inside CDATA no longer `.replace(/&/g,"&amp;")` (produced literal `&amp;amp;`); escape only `]]>`.
- **`/search` + `/workspace/model-studio` noindex.** `/search` (a client-component page) only set a title in its layout, so it inherited the root layout's *homepage* canonical — a canonical-dupe of `/`. Gave it a self-canonical + noindex.

## Rules
- **Bounded list/pagination routes must 404 out-of-range, never 200+empty.** A soft 404 is a "Crawled – currently not indexed" magnet. When you add the guard to one paginated route, grep for every sibling paginated route and add it there too.
- **Page titles passed to `buildPageMetadata` must be brand-free — with exactly one exception, the homepage.** The layout template + `effectiveTitle` append the site name exactly once each; embedding it doubles it in `<title>` and OG. (Documented inline in `lib/site-config.ts`.)

  **Amended 2026-07-27.** Next.js applies `title.template` to *descendant* segments only, never to the segment that declares it. `app/page.tsx` and `app/layout.tsx` are both the root segment, so the template can never reach the homepage. Stripping the brand from the homepage title in this very fix therefore left `/` shipping `<title>Your Fractional Data Team for Startups & SMBs</title>` with no brand at all, while `/about`, `/blog` and `/contact` correctly ended in `— Archos Labs`. Verified live 2026-07-27.

  The fix is `buildPageMetadata({ absoluteTitle: true })`, used by `app/page.tsx` **only** — it emits `title.absolute`, which bypasses ancestor templates and bakes the brand in directly. Setting it on any child route double-brands that route. The rule above still holds everywhere else.
- **Public, indexable routes should be ISR (`revalidate=N`), not `force-dynamic`.** `force-dynamic` means every Googlebot fetch is a cold DB round-trip — slow TTFB throttles crawl on a low-authority domain. `isBlogEnabled()` fails closed, so ISR routes still build in CI with no DB.
- **Any `dangerouslySetInnerHTML` with a JSON-LD blob goes through `jsonLdScript()`** — never bare `JSON.stringify` — even when the fields look trusted (admin-managed). It's `<script>`, not HTML: escape `<`/U+2028/U+2029, not DOMPurify.
- **A client-component page can't export metadata** — it inherits the nearest layout's, including the root's homepage canonical. Give it a sibling `layout.tsx` with a self-canonical (+ noindex for utility pages) or it reads as a duplicate of `/`.

## Still open (need a decision — see log)
- Blog posts + index + category + CMS + marketing pages are all still `force-dynamic` (biggest crawl-budget lever; ISR needs `revalidatePath` on admin publish + a preview-cookie refactor).
- Unlisted posts render indexable with a self-canonical and no internal links (intentional "preserve backlink equity" per code comment) — orphan indexable pages; noindex-vs-keep is an SEO-strategy call.
- `/ai-readiness-assessment` (landing) and `/tools/ai-readiness` (the tool) share the title "AI Readiness Assessment" and both index — competing duplicate.
