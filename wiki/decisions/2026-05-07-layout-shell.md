---
title: Layout shell — header, footer, nav
category: decision
created: 2026-05-07
updated: 2026-05-07
related: [[2026-05-07-linear-redesign]], [[2026-05-07-brand-foundation]], [[backlog]], [[index]]
---

> **Superseded 2026-05-07** by [[2026-05-07-linear-redesign]]. Header is now a sticky transparent-over-hero with backdrop-blur on scroll; footer is a single line (logo left, copyright right). The structural details below — 4-link nav, mobile stacking, single `<main>` per page — are still in effect.

Persistent chrome for archoslabs.xyz. Single header with wordmark + 4-link nav (Home, Tools, Consulting, Modelling Room), single footer with brand line + tagline + year. Mobile-first; stacks vertically below `sm` breakpoint.

## Decision

**Components**
- `components/layout/header.tsx` — wordmark left, nav right; stacks on mobile
- `components/layout/nav.tsx` — flat link list, no dropdowns, no mobile menu disclosure
- `components/layout/footer.tsx` — three-column footer on `sm+`, stacked on mobile

**Wired into `app/layout.tsx`** as siblings of a `<div className="flex-1 flex flex-col">{children}</div>` wrapper. The wrapper is a `<div>` (not `<main>`) so each page owns its own `<main>` element — preserves a single `<main>` per document for accessibility.

**Nav structure**
Four links matching the four HQ sections from CLAUDE.md project overview:

| Path | Label |
| --- | --- |
| `/` | Home |
| `/tools` | Tools |
| `/consulting` | Consulting |
| `/modelling-room` | Modelling Room |

Routes for Tools, Consulting, and Modelling Room don't exist yet — they 404 until later phases build them. Acceptable for Phase 0a; the nav structure ships once and is never revisited just because a section was added.

**Mobile behaviour**
- Header `< sm`: wordmark on its own row, nav on its own row, both left-aligned. All four nav links fit on one line at 390px width with `text-sm` and `gap-x-5`.
- Header `sm+`: horizontal flex with wordmark left, nav right.
- Footer mirrors the same pattern.

**No hamburger menu.** With only four short links the disclosure pattern is unnecessary complexity. Per CLAUDE.md: "When in doubt, remove."

## Reasoning

The skeptical-CDO test ("would a CDO at a major Australian bank trust this enough to book a call") forces every chrome decision toward calm restraint:

- **No logo mark** — wordmark only. A logo would announce more brand confidence than a 1-month-old practice has earned.
- **No CTA in the header** — the home page has the CTA. A header CTA on a 4-page site is noise; on a 40-page site it's wayfinding. We have 1.
- **No utility links in the footer yet** — Privacy and Terms come in Phase 1 item 13 alongside the contact form. A footer link to a non-existent page is worse than no link.
- **Single hairline rule** above and below — `border-rule` (#e5e5e5). Editorial separator, not a shadow or gradient.

## Verification

Verified 2026-05-07 via `node scripts/screenshot.mjs` at desktop (1280x800) and mobile (390x844) viewports.

- Desktop: wordmark and nav share one row; nav right-aligned; hairline rule visible top and bottom.
- Mobile: header stacks vertically; "Modelling Room" stays on one line at 390px; no overflow or wrapping.
- Computed styles on `body`, `h1`, `a` match brand tokens. Header link colour resolves to ink (correct — wordmark is not a CTA, only `Engage Consulting` and the nav-active state should use accent).

Persistence across route changes will be re-verified once `/tools`, `/consulting`, `/modelling-room` exist.

## What this does NOT decide

- Active-link styling (deferred — will add when more than one route exists to navigate between)
- Mobile menu disclosure (not needed at four links; revisit if nav grows past six)
- Sticky/transparent header behaviour (deferred — current solid border is sufficient)
- Footer utility links (deferred to Phase 1 with Privacy + Terms)
