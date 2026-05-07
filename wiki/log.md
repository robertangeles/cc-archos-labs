---
title: Session Log
category: synthesis
created: 2026-05-07
updated: 2026-05-07
related:
---

Append-only log of sessions. Newest entry at the top.

## 2026-05-07 — Phase 0 item 1 complete: brand foundation

- Built brand foundation per Rob's brand decisions (editorial serif + clean sans; monochrome editorial with ink blue accent).
- Files: `app/layout.tsx` (Source Serif 4 + Inter via `next/font/google`), `app/globals.css` (Tailwind v4 `@theme` token block), `app/page.tsx` (minimal verification page demonstrating tokens).
- Installed `@playwright/test` + chromium. Per **new CLAUDE.md rule** added by Rob this session ("Every user-facing feature needs to be tested using Playwright"), all UI changes from now on must include a Playwright check.
- Wrote `scripts/screenshot.mjs` as the standing visual verification harness. Captured desktop (1280x800) and mobile (390x844) screenshots; computed styles confirmed every brand token resolves correctly with no silent fallbacks.
- Decision recorded: `wiki/decisions/2026-05-07-brand-foundation.md`.
- **Bug fix during session:** Turbopack crashed mid-session with "We couldn't find the Next.js package from project directory: ...\app". Fixed by setting `turbopack.root` in `next.config.ts`. Recorded as lesson: `wiki/lessons-learned/2026-05-07-turbopack-root.md`.
- **Next:** Phase 0 item 2 (layout shell — header, footer, nav).

## 2026-05-07 — Backlog reordered: ship credible, then harden

- Rob pushed back on Phase 0 ordering: with an 11-day revenue deadline (~2026-05-18), a sendable URL must come before CI hardening.
- New Phase 0 order: (1) Brand foundation → (2) Layout shell → (3) Home page + consulting CTA → (4) Render deploy + custom domain. Items 5–7 (CI, Vitest, Husky) move below the deploy line. Wiki scripts (item 8) parallelisable.
- Renumbered Phase 1 (Home moved into Phase 0).
- Saved memory: `feedback_ship_credible_first.md` (principle: revenue-urgency means ship-then-harden) and `project_revenue_deadline.md` (~2026-05-18 deadline anchors all prioritisation until then).
- **Next:** start brand foundation. Blocked on a single brand-direction decision (typography + colour palette) — asking Rob before silently picking.

## 2026-05-07 — Backlog initialised

- Verified folder structure matches CLAUDE.md (app/, components/, lib/, public/, wiki/, scripts/) — no changes needed.
- Wiki structure already in place from bootstrap session — no init needed.
- Created `wiki/backlog/backlog.md` with prioritised HQ build list across 4 phases (Foundation, Revenue Now, Lead Gen, Growth) plus cross-cutting concerns and explicit out-of-scope list. Each item has a verify criterion per CLAUDE.md "Goal-Driven Execution".
- Updated `wiki/index.md` to point to the backlog.
- **First build priority:** Phase 0 items 1–6 in order (CI, tests, Render deploy, pre-commit hooks, brand foundation, layout shell), then Phase 1 item 8 (Home page).
- **Flagged for user:** prompt mentioned "Next.js 15" but project is on Next.js 16 (per the decision committed in `0e6e408`). No code changes made; flagged for confirmation.

## 2026-05-07 — Project bootstrap

- Scaffolded Next.js 16.2.5 + TypeScript + Tailwind v4 + ESLint into project root via `pnpm create next-app` (App Router, no `src/` dir, `@/*` alias).
- Created folder structure per CLAUDE.md: `app/api/{diagnostic,contact}/`, `components/{ui,diagnostic,layout}/`, `lib/`, `public/{images,fonts}/`, `wiki/{entities,concepts,decisions,synthesis,raw-index,backlog,lessons-learned}/`, `scripts/`.
- Seeded `wiki/index.md` and `wiki/log.md`.
- Set local dev port to 3007 (CLAUDE.md mandate).
- Initialized git, first commit on `main` (author: Rob Angeles <trebor.selegna@outlook.com>).
- **Decision:** kept Next.js 16.2.5 (scaffold default). Updated CLAUDE.md tech stack from "Next.js 15" to "Next.js 16".
