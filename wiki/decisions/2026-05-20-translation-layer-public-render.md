---
title: Translation Layer — Phase B public render
category: decision
created: 2026-05-20
updated: 2026-05-20
related: [[2026-05-19-translation-layer-migration]], [[2026-05-18-pages-cms-expansion]]
---

Phase B of the rosy-bee migration: ship the public /blog surface (routes, components, AIEO foundations) behind a feature flag so the 253 migrated posts can render in dev/preview before the Phase C cutover.

## Decision

Ship one cohesive PR that adds: the read queries, the article + index render, the supporting components, the AIEO routes, and the admin toggle — all gated by a `blog_enabled` site_setting flag that defaults to FALSE.

## What ships

| Layer | Files |
|---|---|
| Feature flag | `lib/blog/feature-flag.ts` (mirror of `lib/pages/feature-flag.ts` but defaults to FALSE — fails closed) |
| DB read queries | `lib/posts.ts` (getPostBySlug, listPosts, listByCategory, getReadNext via HNSW ANN, getRecentPosts, getCategoryBySlug, listAllCategories, listAllPostsForFeeds, listAllPostsForLlmsFull) |
| Render helpers | `lib/post-rendering.ts` (generateToc, slugifyHeading, formatLastReviewed, formatPublishedDate) |
| JSON-LD | `lib/structured-data.ts` (Article, Person, Breadcrumb, Organization, jsonLdScript) |
| AIEO body | `lib/llms-txt.ts` (buildLlmsTxt, buildLlmsFullTxt) |
| Public routes | `app/blog/page.tsx`, `app/blog/[slug]/page.tsx`, `app/blog/category/[slug]/page.tsx`, `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts` |
| Sitemap/robots | extended `app/sitemap.ts` (+ /blog, categories, posts) and `app/robots.ts` (+ 10 AI crawler allowlist entries) |
| Components | `components/blog/{post-header, post-body, toc, read-next, editorial-list-row, category-chips, author-bio, pagination, heading-copy-link-button}.tsx` |
| Admin | `app/admin/(authed)/blog/page.tsx` + `app/api/admin/settings/blog-enabled/route.ts` + new "Blog" tab in `admin-tab-nav.tsx` |
| Tests | `lib/post-rendering.test.ts`, `lib/structured-data.test.ts`, `lib/llms-txt.test.ts` (unit, 25+ assertions) |

## Why one PR

Per Phase B plan, B1–B5 form a complete coherent unit ("blog viewable behind a flag"). Splitting was considered (routes-only first, then components/polish). Rejected because:
- Components have no value without routes; routes have no UX without components.
- All gated by the flag = no public exposure until Phase C cutover, so review pressure is uniform.
- Single review pass lets DESIGN.md tokens be enforced holistically (eyebrow on /blog index matches eyebrow on post page matches eyebrow on read-next cards).

## Design decisions enforced

- DES-1 (read-next): 3-column card grid, **no icons-in-circles, no centered text, no border-left stripe, no shadow, no "Read more →"**. Eyebrow + title + one-line excerpt only. Single column on mobile (not 2-up).
- DES-3 (OG image): served from R2 via `og_image_path` set at migration. No runtime regeneration.
- DES-4 (newsletter capture): DEFERRED — sits in Phase D alongside Resend integration.
- /blog index uses the **editorial-list pattern** (hairline-separated rows, not cards) — distinct from read-next on purpose; index is high-density library.
- AI-slop blacklist (DESIGN.md): no gradients, no decorative SVGs, no centered hero copy, no pill buttons.

## SEO + AIEO foundations

Per plan section 0C-bis baked-in scope:

- **JSON-LD** on every post: Article (with headline, datePublished, dateModified, wordCount, articleSection, author Person, publisher Organization, image, keywords) + standalone Person + BreadcrumbList.
- **Canonical link + OG meta** via the existing `buildPageMetadata` helper.
- **`/llms.txt`** — top-20 listed posts with one-line descriptions.
- **`/llms-full.txt`** — full corpus dump (every listed post with body).
- **`/robots.txt`** — explicit allow for GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Bingbot, Applebot-Extended, CCBot, anthropic-ai, Cohere-ai.
- **`/sitemap.xml`** — `force-dynamic`; includes /blog, every category, every listed post, with `<lastmod>` from `last_reviewed_at` or `published_at` and priority boost for posts <60 days old.

## Feature flag posture

Default FALSE. The migration data + R2 assets land on prod ahead of cutover; the routes return notFound() until the operator flips the flag from `/admin/blog`. Fail-closed (vs Pages CMS which fails-open) because the blog is a brand-new public surface — a transient DB blip should never accidentally publish unfinished content.

Cache invalidation: in-memory `cachedPromise` cleared by the admin PUT endpoint. Direct SQL flips do NOT invalidate (matches pages_cms_enabled semantics). Tested manually.

## What's NOT in this PR (deferred to Phase D)

- Newsletter capture + Resend wiring (D1)
- `/search` + Cmd-K modal (D2)
- Admin needs_review queue UI for the 120 flagged posts
- RSS `feed.xml` (D polish)
- Per-post admin (status/visibility/tags edit) — schema exists, UI is Pages-CMS-Phase-3 territory
- Audio TTS, "mentioned-in" backlinks, print stylesheet (TODOs from CEO plan)

## Verification (Phase B pass criteria from plan)

- [x] `pnpm tsc` clean
- [x] `pnpm test` — 450 passing, including 25+ new tests on TOC, JSON-LD, llms-txt
- [x] `pnpm build` — all new routes appear in route manifest; sitemap.xml is `ƒ Dynamic`
- [x] `pnpm lint` — clean
- [x] Curl smoke: /blog 200, /blog/[slug] 200 (with 3× JSON-LD scripts), /blog/category/[slug] 200, /llms.txt 200, /llms-full.txt 200 (1.1 MB), /sitemap.xml 200 (257 /blog entries), /robots.txt names 10 AI bots
- [x] /blog/nonexistent 404, /blog/category/nonexistent 404
- [ ] Phase C cutover: admin flips flag → preview deploy spot-check → flip prod (separate PR)
