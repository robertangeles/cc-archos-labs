---
title: Google Tag Manager (analytics container)
category: entity
created: 2026-07-24
updated: 2026-07-24
related: [[about-page]], [[deployment-architecture]]
---

Site-wide Google Tag Manager container (`GTM-TDT86Q37`) for any future marketing tags. **Both live trackers — GA4 and the Meta Pixel — are installed in CODE, not in GTM** (the operator chose the deploy-and-verify route for each). GTM is currently an empty container: it loads but holds no tags. See below.

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

- **GA4 → code (shipped 2026-07-24).** Installed in `components/analytics/google-analytics.tsx` (gtag.js), env-gated by `NEXT_PUBLIC_GA_ID` (prod `G-LLN8BG92ZT`). Server component — no client hooks. SPA page views rely on GA4 Enhanced Measurement's "page changes based on browser history events" (default on), which fires on Next.js client navigations (History API). **Do NOT also add a GA4 tag in GTM with the same id — double-counts.**
- **Meta Pixel → code (shipped 2026-07-24).** Installed directly in `components/analytics/meta-pixel.tsx`, env-gated by `NEXT_PUBLIC_FB_PIXEL_ID` (prod pixel `28739401002314414`). The operator chose the code route so the pixel is owned + verified end-to-end (no GTM clicking). SPA page views are handled in code: `PixelRouteTracker` fires `fbq('track','PageView')` on each route change (skips the first, which the init snippet already sends). **Do NOT also add a Meta Pixel tag inside GTM — it would double-count every PageView.**

Why the split: the operator preferred a delegated, deploy-and-verify install for the pixel over configuring a GTM tag by hand. GTM stays the home for GA4 and anything added later.

## Not to be confused with

`lib/analytics.ts` + `components/analytics/analytics-client.tsx` — the **internal** product event tracker (`track("page.viewed" …)`, scroll depth) from the home-page PAS rewrite (PR #53). That is a separate first-party system and is unrelated to GTM/GA4/Meta.

## Consent Mode v2 + cookie banner (shipped 2026-07-25)

`components/analytics/consent.ts` + `consent-banner.tsx` + an inline consent-default script in `app/layout.tsx`.

- **Region-scoped default.** An inline (synchronous) script sets Consent Mode v2 defaults **before** any Google tag: `granted` globally, `denied` for EEA+UK+CH (`EEA_REGIONS`, applied by Google via the visitor's IP region). AU / US / rest-of-world analytics are unaffected. All four v2 signals set (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`).
- **Two-button banner** (`ConsentBanner`, matches the design system) shows once; **Accept**/**Reject** call `gtag('consent','update', …)` + Meta `fbq('consent', grant/revoke)` live and persist the choice in `localStorage` (`archos_consent`). Shown whenever any tracker id is set.
- **Meta Pixel** has no native region consent, so `meta-pixel.tsx` gates before init: revoke if the visitor rejected, or (no choice yet) if their timezone is `Europe/*` — a dependency-free EEA heuristic. Google's side stays precise via Consent Mode regions.

Verified by a headless smoke: default set before tags, banner shows, Accept → consent update + persist, reload respects the stored choice.

Still deferred: nothing blocking. A granular (per-category) banner and a "change your choice" re-open link could be added later if needed. Privacy `/privacy` already discloses GA4 + Meta Pixel + opt-out (edited in DEV+PROD, see log 2026-07-24).
