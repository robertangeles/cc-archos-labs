---
title: Google Tag Manager (analytics container)
category: entity
created: 2026-07-24
updated: 2026-07-24
related: [[about-page]], [[deployment-architecture]]
---

Site-wide Google Tag Manager container — the single vehicle for GA4, Meta (Facebook) Pixel, and any future marketing/analytics tag. Configured in the GTM dashboard, not in code.

## What ships in code

- `components/analytics/google-tag-manager.tsx` — two server components:
  - `GoogleTagManager` — the container loader (`next/script`, `afterInteractive`).
  - `GoogleTagManagerNoScript` — the `<noscript>` iframe fallback; rendered as the **first child of `<body>`** in `app/layout.tsx` (Google requires it immediately after the opening body tag).
  - `gtmSnippet(id)` — the pure loader-snippet builder, unit-tested in `google-tag-manager.test.tsx`.
- Wired in `app/layout.tsx` from `process.env.NEXT_PUBLIC_GTM_ID`.

Both components **render nothing when the id is unset** — so local dev and Render preview builds never load GTM or pollute production metrics.

## The one env var

`NEXT_PUBLIC_GTM_ID` — public by design (ships in client HTML). Prod container: **`GTM-TDT86Q37`**. Set it in the Render dashboard env. Because `NEXT_PUBLIC_*` is **inlined at build time**, it must be present when Render runs `next build` (it always is — dashboard env is available at build). Left unset locally.

## GA4 + Meta Pixel live in GTM, not code

The code installs the container only. GA4 and Meta Pixel are added as **tags inside the GTM dashboard** — no code deploy to add, change, or remove a tag. This is why there is no `gtag`/`fbq` snippet in the repo.

- **GA4** — add a "Google Tag" (GA4) in GTM with the Measurement ID. SPA page views are automatic: GA4 Enhanced Measurement's "page changes based on browser history events" (default on) fires on Next.js client navigations, which use the History API.
- **Meta Pixel** — add via the community Meta Pixel template (or a Custom HTML tag). For SPA page views, trigger a `PageView` tag on GTM's built-in **History Change** trigger.

## Not to be confused with

`lib/analytics.ts` + `components/analytics/analytics-client.tsx` — the **internal** product event tracker (`track("page.viewed" …)`, scroll depth) from the home-page PAS rewrite (PR #53). That is a separate first-party system and is unrelated to GTM/GA4/Meta.

## Open follow-up — consent + privacy

GTM currently loads its tags **unconditionally (no cookie-consent gate)**. Before enabling for EU/UK traffic: wire **Google Consent Mode v2** in GTM + a consent banner, and disclose GA4 + Meta Pixel in the DB-backed `/privacy` page (edited via `/admin/pages`, not in code). Tracked in [[backlog]].
