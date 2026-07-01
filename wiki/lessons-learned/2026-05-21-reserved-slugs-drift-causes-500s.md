---
title: Adding a top-level app/ route requires updating RESERVED_SLUGS (or 404s become 500s)
category: lessons-learned
created: 2026-05-21
updated: 2026-05-21
related: [[2026-05-18-pages-cms-expansion]], [[2026-05-21-indexnow]]
---

## Problem

For weeks, every URL that should have returned 404 on `archoslabs.xyz` was actually returning **HTTP 500**. The bug was invisible to normal users (homepage and all linked routes work) but:

- Surfaced in Render deploy logs as repeated `Pages CMS guard: top-level app/ route(s) not in RESERVED_SLUGS — [blog, llms-full.txt, llms.txt]` errors
- Made unknown URLs (typos, link rot, bot probes) return a 500 instead of a clean 404
- Bad for SEO — Google treats 500s as transient and keeps re-crawling, vs 404s which it eventually drops
- Made deploy logs noisy in a way that hid real errors
- Discovered only after `app/indexnow.txt/` was deleted in [[2026-05-21-indexnow]] and `/indexnow.txt` started 500-ing as a side effect

## Root cause

The Pages CMS catch-all at `app/[...slug]/page.tsx` runs `runBootCheck()` on first render of any path it handles. The boot check (in `lib/pages/boot-check.ts`) scans `app/` for top-level directories and throws if any are NOT in `RESERVED_SLUGS` (or in the small `CMS_MANAGED_SLUGS` set: `{privacy, terms}`).

Three directories had drifted out of sync:
- `app/blog/` — added when the Translation Layer migration shipped
- `app/llms.txt/` — added for the AI-crawler index
- `app/llms-full.txt/` — added for the full-corpus dump

None were added to `RESERVED_SLUGS`. The boot check fired on every catch-all render and threw the error → Next caught it → 500 response.

Static routes always took precedence over the catch-all, so legitimate URLs (`/`, `/about`, `/blog`, `/contact`, `/sitemap.xml`, etc.) worked normally. Only paths that fell through to `[...slug]` ever hit the check.

## Fix

Add the three slugs to `RESERVED_SLUGS` in `lib/pages/reserved-slugs.ts`. One-line change.

Also added a regression-guard test in `lib/pages/reserved-slugs.test.ts` that explicitly asserts these three slugs are reserved — if a future refactor removes them, the test fails loudly before the deploy.

## Rule

**Whenever you add a top-level directory under `app/`, you MUST also add its name to `RESERVED_SLUGS` in `lib/pages/reserved-slugs.ts`.** This applies to any folder name, including those with extensions like `.txt`. The boot-check guard is the safety net — it'll fail the first request that hits the catch-all — but it's better to update the set in the same PR that adds the route.

The error message itself prescribes the fix:
> Add them to lib/pages/reserved-slugs.ts or the catch-all will shadow them.

If you see this in deploy logs, don't wait — fix the set immediately.

## Why it stayed hidden so long

- No alerting on 500-class responses to unknown paths
- Normal users never visit unknown paths
- The boot-check error mentions the fix but is buried in deploy logs that nobody reads unless investigating something else
- Static routes always render fine, so the home/about/contact happy path never trips the bug

Future safeguard worth considering: a `health/404` route that intentionally renders an unknown path and asserts the response is 404 (not 500). Would catch this drift in CI. Out of scope for this hotfix; flag in backlog if the bug recurs.

## Recurrence — 2026-07-01

It recurred. `app/search/` and `app/workspace/` shipped as top-level routes
without being added to `RESERVED_SLUGS`, so PROD logs filled with
`Pages CMS guard: … RESERVED_SLUGS — [search, workspace]` and every 404-class
request 500-ed again. Same one-line fix (added both to the set) plus a regression
assertion in `reserved-slugs.test.ts`. The boot-check net did its job — it just
isn't a substitute for updating the set in the PR that adds the route. The
`health/404` CI safeguard mooted above is now worth building; the class has fired
twice.
