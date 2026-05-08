---
title: Wiki Index
category: synthesis
created: 2026-05-07
updated: 2026-05-08
related: [[backlog]], [[2026-05-08-resend-with-external-recipient]], [[2026-05-08-godaddy-smtp-for-contact-form]], [[2026-05-08-render-postgres-over-neon]], [[2026-05-08-phase2-ceo-review]], [[2026-05-08-admin-deferred]], [[2026-05-07-linear-redesign]], [[2026-05-07-brand-foundation]], [[2026-05-07-layout-shell]], [[2026-05-07-home-page]], [[2026-05-07-turbopack-root]], [[2026-05-07-tailwind-v4-new-utilities]]
---

Master catalog of all wiki pages. Read this at the start of every session.

## entities
_(none yet)_

## concepts
_(none yet)_

## decisions
- [Resend with an external recipient mailbox for the contact form](decisions/2026-05-08-resend-with-external-recipient.md) — current contact-form path; Resend → Outlook/Gmail (never a GoDaddy-cPanel mailbox)
- [GoDaddy SMTP for the contact form](decisions/2026-05-08-godaddy-smtp-for-contact-form.md) — _FAILED, superseded same day_; Render's outbound IPs are blocked by GoDaddy's cPanel firewall
- [Render Postgres over Neon for database hosting](decisions/2026-05-08-render-postgres-over-neon.md) — single-provider simplicity at deploy-setup; supersedes the Neon choice from the Phase 2 CEO review
- [Phase 2 (AI Readiness Assessment) — CEO review decisions](decisions/2026-05-08-phase2-ceo-review.md) — HOLD SCOPE on the spec; surgical reductions (drop benchmarks, staged progress UI, Puppeteer PDF); stack swapped from Supabase to Render Postgres + Drizzle + Resend (DB provider revised same day — see entry above)
- [Admin space — deferred](decisions/2026-05-08-admin-deferred.md) — defer admin entirely until Phase 2 ships and there's content/leads to manage; env vars + platform dashboards cover everything until then
- [Linear-quality redesign — dark theme, Inter, 8pt grid](decisions/2026-05-07-linear-redesign.md) — current foundation; supersedes the three editorial decisions below
- [Brand foundation — typography and colour tokens](decisions/2026-05-07-brand-foundation.md) — _superseded_; original editorial Source Serif 4 + Inter direction
- [Layout shell — header, footer, nav](decisions/2026-05-07-layout-shell.md) — _superseded_ on styling; structural shape (4-link nav, mobile stacking) carries forward
- [Home page (`/`) — Phase 0a structure and copy](decisions/2026-05-07-home-page.md) — _superseded_ on styling; copy and four-section structure carry forward

## synthesis
_(none yet)_

## lessons-learned
- [Turbopack workspace root must be set explicitly on Next.js 16](lessons-learned/2026-05-07-turbopack-root.md) — set `turbopack.root` in `next.config.ts` from day one when project lives inside a shared parent dir
- [Tailwind v4 dev server doesn't always compile new utility names on hot-reload](lessons-learned/2026-05-07-tailwind-v4-new-utilities.md) — re-save `globals.css` after introducing new `--color-*` tokens; values hot-reload, names don't

## raw-index
_(none yet)_

## backlog
- [Archos Labs HQ — Build Backlog](backlog/backlog.md) — prioritised build list, ordered by what unblocks revenue and reduces risk
