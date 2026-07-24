---
title: Google Tag Manager (analytics container)
category: entity
created: 2026-07-24
updated: 2026-07-24
related: [[about-page]], [[deployment-architecture]]
---

Site-wide Google Tag Manager container for GA4 and future marketing tags, configured in the GTM dashboard. **The Meta (Facebook) Pixel is the exception — it is installed in code, NOT in GTM** (see below).

## What ships in code

- `components/analytics/google-tag-manager.tsx` — two server components:
  - `GoogleTagManager` — the container loader (`next/script`, `afterInteractive`).
  - `GoogleTagManagerNoScript` — the `<noscript>` iframe fallback; rendered as the **first child of `<body>`** in `app/layout.tsx` (Google requires it immediately after the opening body tag).
  - `gtmSnippet(id)` — the pure loader-snippet builder, unit-tested in `google-tag-manager.test.tsx`.
- Wired in `app/layout.tsx` from `process.env.NEXT_PUBLIC_GTM_ID`.

Both components **render nothing when the id is unset** — so local dev and Render preview builds never load GTM or pollute production metrics.

## The one env var

`NEXT_PUBLIC_GTM_ID` — public by design (ships in client HTML). Prod container: **`GTM-TDT86Q37`**. Set it in the Render dashboard env. Because `NEXT_PUBLIC_*` is **inlined at build time**, it must be present when Render runs `next build` (it always is — dashboard env is available at build). Left unset locally.

## Where each tracker lives

- **GA4 → GTM (planned).** Add a "Google Tag" (GA4) in the GTM dashboard with the Measurement ID — no code deploy. SPA page views are automatic: GA4 Enhanced Measurement's "page changes based on browser history events" (default on) fires on Next.js client navigations, which use the History API.
- **Meta Pixel → code (shipped 2026-07-24).** Installed directly in `components/analytics/meta-pixel.tsx`, env-gated by `NEXT_PUBLIC_FB_PIXEL_ID` (prod pixel `28739401002314414`). The operator chose the code route so the pixel is owned + verified end-to-end (no GTM clicking). SPA page views are handled in code: `PixelRouteTracker` fires `fbq('track','PageView')` on each route change (skips the first, which the init snippet already sends). **Do NOT also add a Meta Pixel tag inside GTM — it would double-count every PageView.**

Why the split: the operator preferred a delegated, deploy-and-verify install for the pixel over configuring a GTM tag by hand. GTM stays the home for GA4 and anything added later.

## Not to be confused with

`lib/analytics.ts` + `components/analytics/analytics-client.tsx` — the **internal** product event tracker (`track("page.viewed" …)`, scroll depth) from the home-page PAS rewrite (PR #53). That is a separate first-party system and is unrelated to GTM/GA4/Meta.

## Open follow-up — consent + privacy

GTM currently loads its tags **unconditionally (no cookie-consent gate)**. Before enabling for EU/UK traffic: wire **Google Consent Mode v2** in GTM + a consent banner, and disclose GA4 + Meta Pixel in the DB-backed `/privacy` page (edited via `/admin/pages`, not in code). Tracked in [[backlog]].
