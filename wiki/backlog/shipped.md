---
title: Shipped Backlog Items
category: synthesis
created: 2026-05-17
updated: 2026-05-17
related: [[backlog]], [[state]], [[2026-05-08-phase2-ceo-review]], [[book-a-call-architecture]]
---

Historical record of items moved out of [[backlog]] once shipped. For current ship state by route / endpoint / component, see [[state]] (auto-generated, always fresh). [[backlog]] going forward describes **intent only**.

## Phase 0 — Foundation (shipped 2026-05-07 onwards)
- Item 1 — Brand foundation (typography scale, colour tokens, spacing via Tailwind v4 `@theme`). See [[2026-05-07-linear-redesign]].
- Item 2 — Layout shell (`components/layout/{header,footer,nav}.tsx`). See [[2026-05-07-layout-shell]].
- Item 3 — Home page (`/`) with consulting CTA. See [[2026-05-07-home-page]]. **Note:** superseded by the May 2026 PAS rewrite (separate PR).
- Item 4 — Render deploy + custom domain. `https://archoslabs.xyz` live.
- Items 5–7 — CI pipeline, Vitest, Husky + lint-staged. Confirm via `package.json` devDependencies + `.husky/` files.

Item 8 — Wiki tooling scripts (`wiki-search.mjs`, `wiki-graph.mjs`) — **NOT yet shipped.** This PR ships a different tool (`wiki-state.mjs`) for ship-state tracking.

## Phase 1 — Revenue Now (partial)
- Item 10 — Contact endpoint (`POST /api/contact`). See [[state]].
- Item 11 — Contact form UI ([components/contact/contact-form.tsx]).
- Item 13 — Privacy + terms pages (`/privacy`, `/terms`). See [[state]].

Items 9 (Consulting page) and 12 (SEO meta) remain in [[backlog]] — not yet shipped per [[state]].

## Phase 1.E — Book a Call (shipped 2026-05-17)
- Item 29 — Lane B: Google Calendar OAuth + Calendar API + booking page + Claude pre-call brief + Resend confirmations + AI follow-up question on intake. PRs #41, #42, #44, #45, #46, #48. See [[book-a-call-architecture]] and [[booking-prompts-in-db]].
- Item 30 — Lane C: Calendar slot math + scheduler with FOR UPDATE SKIP LOCKED + cron-driven queue drain. PRs #39, #40, #44. See [[book-a-call-architecture]].

Phase 1.E follow-ups (items 31–34) remain in [[backlog]] — not yet shipped.

## Phase 2 — AI Readiness Assessment (shipped 2026-05-13)
Items 14–25 inclusive. Full route set at `/tools/ai-readiness` (welcome → questions → registration gate → report → PDF → share tokens → return-visitor portal), backed by `/api/diagnostic/*` endpoints, magic-link auth via `/api/auth/lead/*`, and admin diagnostic settings at `/admin/(authed)/diagnostic`. See [[2026-05-08-phase2-ceo-review]] for the CEO review and [[state]] for the live route list.

The PDF audit on 2026-05-17 found [[backlog]] still claimed Phase 2 was "in progress" — that staleness is why [[state]] now exists.

## Phase 2.5 — IP-sensitive content moved to DB (shipped 2026-05-12 / 2026-05-13)
- Item 26 — Claude system prompt moved to Settings (PR #9). Source has generic fallback; real prompt lives in `site_setting` key `'diagnostic_prompt'`, edited via `/admin/prompts`.
- Item 27 — Diagnostic content moved to DB (PR #12). Source has placeholder fallback; real content lives in `site_setting` key `'diagnostic_content'`, edited via `/admin/diagnostic`. `pnpm extract-content` recovers historical content from git history.
- Item 28 — Sensitive wiki relocated. `wiki/concepts/diagnostic-scoring-logic.md` and `wiki/decisions/2026-05-09-diagnostic-scoring-calls.md` rewritten as architecture overviews; specific values + persona test results redacted out of public docs. Original content recoverable via git history.

## What still belongs in [[backlog]]

Items still describing intent (not ship state):
- Item 8 — Wiki tooling scripts (`wiki-search.mjs`, `wiki-graph.mjs`)
- Item 9 — Consulting page (`/consulting`)
- Item 12 — Basic SEO + meta
- Items 31–34 — Phase 1.E follow-ups (admin status flip, consultant profile UI, blog library wiring, cron alert)
- Phase 3 items (Modelling Room page, Tools index, analytics, newsletter signup)
- The May 2026 Home Page PAS rewrite (separate plan, separate PR — Workstream 2)
