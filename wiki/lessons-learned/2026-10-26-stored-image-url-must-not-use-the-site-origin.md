---
title: A stored absolute image URL crashed the /blog index on DEV
category: synthesis
created: 2026-10-26
updated: 2026-10-26
related: [[2026-10-24-remove-blog-agent-pipeline]], [[2026-10-24-remove-ai-slop-posts]], [[deployment-architecture]]
---

## Problem

`/blog` on the local dev server threw `Invalid src prop (http://localhost:3007/images/blog-fallback.webp) on next/image, hostname "localhost" is not configured`, from `EditorialListRow` (`components/blog/editorial-list-row.tsx`, which passes `post.ogImagePath` straight to `next/image`).

## Why

Confirmed: one DEV row, `where-ai-sits-determines-what-you-measure` (status `published`, `archived_at` null), stored `og_image_path = http://localhost:3007/images/blog-fallback.webp`. The other 343 stored image URLs are `https://pub-cb13...r2.dev`, the only host in `next.config.ts` `images.remotePatterns`.

Confirmed: the removed `attachFallbackImageToPost` (`git show 5b2b261:lib/posts-admin/attach-image.ts`) wrote `${getSiteUrl()}/images/blog-fallback.webp`, an absolute URL built from whatever origin the process ran under. That row's `og_image_generated_at` is 2026-08-10, run locally.

Confirmed: DEV is a snapshot that stops at 2026-08-10 (newest post and update). It never received the 2026-10-24 purge, which set `archived_at` on 206 posts. This slug is on that purge's redirect list (`lib/blog-removed-redirects.json`) and PROD answers 308 for it.

PROD is clean, checked from outside: all 34 public `/blog` pages carry only R2 image URLs. The PROD database itself was not read (the read-only query tool was denied).

[Inference] `next/image` throws on an unconfigured host only in development; in production the same row would render a broken thumbnail (the `/_next/image` request is refused) and the page would still return 200. Not tested on a production build, so a 200 from PROD is not proof of clean data. The page scan above is.

## Fix

DEV row archived the way the purge archived it (`archived_at` and `updated_at` set). No code change: the list query already filters `archived_at IS NULL`, and the only writer of origin-built URLs was deleted with the pipeline. Undo: `UPDATE post SET archived_at = NULL WHERE slug = 'where-ai-sits-determines-what-you-measure';`

## Rule

A stored image URL is an R2 URL or a root-relative path (`/images/...`), never one built from the site origin. A hostname error from `next/image` on a list page is a data problem first: run `SELECT slug, og_image_path FROM post WHERE status = 'published' AND archived_at IS NULL AND og_image_path !~ '^https://pub-cb13acd53ca84910bf06d95811396aed.r2.dev/blog/'`. Because the throw is dev-only, check PROD by scanning the public index pages for `_next/image?url=` values that are not R2.
