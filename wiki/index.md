---
title: Wiki Index
category: synthesis
created: 2026-05-07
updated: 2026-05-13
related: [[backlog]], [[lead-session-and-owner-only-reports]], [[magic-link-sign-in]], [[transactional-email-rendering]], [[2026-05-08-minimal-admin-for-seo]], [[2026-05-08-resend-with-external-recipient]], [[2026-05-08-godaddy-smtp-for-contact-form]], [[2026-05-08-render-postgres-over-neon]], [[2026-05-08-phase2-ceo-review]], [[2026-05-08-admin-deferred]], [[2026-05-07-linear-redesign]], [[2026-05-07-brand-foundation]], [[2026-05-07-layout-shell]], [[2026-05-07-home-page]], [[2026-05-07-turbopack-root]], [[2026-05-07-tailwind-v4-new-utilities]], [[2026-05-08-drizzle-kit-push-hangs-on-render]], [[2026-05-13-email-buttons-need-the-bulletproof-pattern]]
---

Master catalog of all wiki pages. Read this at the start of every session.

## entities
_(none yet)_

## concepts
- [AI Readiness Assessment — Scoring Logic](concepts/diagnostic-scoring-logic.md) — engine architecture: pipeline, branch resolution, domain weighting, tier derivation, risk flags, priority triggers; calibrated values live in /admin/diagnostic
- [Lead session model and owner-only report access](concepts/lead-session-and-owner-only-reports.md) — two cookies one secret, lead upsert by email, sticky priority, why owner-mismatch returns 404 not 401
- [Magic-link sign-in for return visitors](concepts/magic-link-sign-in.md) — sha256-stored tokens, atomic single-UPDATE consume, no enumeration on any surface, latest-report-wins on verify
- [Share tokens for the AI Readiness report](concepts/share-tokens.md) — 7-day TTL public URLs, one-consume-stamp/re-views-OK semantics, many-active-per-report, atomic verify via COALESCE on consumed_at
- [Transactional email rendering — patterns and brand decisions](concepts/transactional-email-rendering.md) — bulletproof button (table + VML + [data-ogsc]), table-row spacing, masthead-outside-card, personal sign-off, palette matched to PDF light-mode tokens

## decisions
- [Diagnostic per-option scoring calibration (overview)](decisions/2026-05-09-diagnostic-scoring-calls.md) — meta-discipline for calibration deviations: four classes of deviation + score-vs-trigger separation pattern; specific values live in /admin/diagnostic
- [Minimal admin for SEO config](decisions/2026-05-08-minimal-admin-for-seo.md) — single-user admin (password + JWT cookie), one site_setting table, drives all SEO/brand metadata; partially supersedes admin-deferred for SEO slice
- [Resend with an external recipient mailbox for the contact form](decisions/2026-05-08-resend-with-external-recipient.md) — current contact-form path; Resend → Outlook/Gmail (never a GoDaddy-cPanel mailbox)
- [GoDaddy SMTP for the contact form](decisions/2026-05-08-godaddy-smtp-for-contact-form.md) — _FAILED, superseded same day_; Render's outbound IPs are blocked by GoDaddy's cPanel firewall
- [Render Postgres over Neon for database hosting](decisions/2026-05-08-render-postgres-over-neon.md) — single-provider simplicity at deploy-setup; supersedes the Neon choice from the Phase 2 CEO review
- [Phase 2 (AI Readiness Assessment) — CEO review decisions](decisions/2026-05-08-phase2-ceo-review.md) — HOLD SCOPE on the spec; surgical reductions (drop benchmarks, staged progress UI, Puppeteer PDF); stack swapped from Supabase to Render Postgres + Drizzle + Resend (DB provider revised same day — see entry above)
- [Admin space — deferred](decisions/2026-05-08-admin-deferred.md) — _partially superseded same day_ for SEO admin slice; full multi-user admin still deferred; env vars + platform dashboards cover everything until then
- [Linear-quality redesign — dark theme, Inter, 8pt grid](decisions/2026-05-07-linear-redesign.md) — current foundation; supersedes the three editorial decisions below
- [Brand foundation — typography and colour tokens](decisions/2026-05-07-brand-foundation.md) — _superseded_; original editorial Source Serif 4 + Inter direction
- [Layout shell — header, footer, nav](decisions/2026-05-07-layout-shell.md) — _superseded_ on styling; structural shape (4-link nav, mobile stacking) carries forward
- [Home page (`/`) — Phase 0a structure and copy](decisions/2026-05-07-home-page.md) — _superseded_ on styling; copy and four-section structure carry forward

## synthesis
_(none yet)_

## lessons-learned
- [Email CTA buttons need the bulletproof pattern from the first attempt](lessons-learned/2026-05-13-email-buttons-need-the-bulletproof-pattern.md) — Outlook desktop strips display:inline-block on `<a>`; Outlook web dark mode rewrites `<a>` color after inline styles resolve; only `<td bgcolor>` + VML + `[data-ogsc]` overrides survive both
- [Puppeteer-on-Render setup needs three things, not one](lessons-learned/2026-05-13-puppeteer-on-render.md) — build command must run `npx puppeteer browsers install chrome`; cache path must be project-local via `PUPPETEER_CACHE_DIR`; navigation target must use `NEXT_PUBLIC_SITE_URL`, not `request.url`
- [Schema drift claims need an origin/main check, not just the working tree](lessons-learned/2026-05-12-schema-drift-needs-origin-main-check.md) — fetch + diff against origin/main before declaring code or tables unreferenced; a feature-branch grep doesn't see what merged to main after you branched off
- [drizzle-kit push hangs on Render Postgres](lessons-learned/2026-05-08-drizzle-kit-push-hangs-on-render.md) — bypass push; use `drizzle-kit generate` + a `postgres-js` SQL applier
- [Turbopack workspace root must be set explicitly on Next.js 16](lessons-learned/2026-05-07-turbopack-root.md) — set `turbopack.root` in `next.config.ts` from day one when project lives inside a shared parent dir
- [Tailwind v4 dev server doesn't always compile new utility names on hot-reload](lessons-learned/2026-05-07-tailwind-v4-new-utilities.md) — re-save `globals.css` after introducing new `--color-*` tokens; values hot-reload, names don't

## raw-index
_(none yet)_

## backlog
- [Archos Labs HQ — Build Backlog](backlog/backlog.md) — prioritised build list, ordered by what unblocks revenue and reduces risk
