---
title: Session Log
category: synthesis
created: 2026-05-07
updated: 2026-05-07
related:
---

Append-only log of sessions. Newest entry at the top.

## 2026-05-08 — Session restart: screenshot harness fixed + Phase 0a/1 committed in chunks

- Previous session ended with "image exceeds 2000px many-image limit". Root cause: `scripts/screenshot.mjs` ran at `deviceScaleFactor: 2` with `fullPage: true` — a 1280-wide viewport doubled to 2560px output and tall pages stretched height past the limit too. Fixed by lowering defaults to 1× DPI and viewport-only, with `--full` and `--dpi=N` overrides for when screenshots aren't being attached. Warns at runtime if the configured output would exceed the limit.
- Found ~12 files of work uncommitted on `main` since `d22c16a` (brand foundation). Committed in 5 logical chunks (no push yet, awaiting Rob's confirmation per CLAUDE.md):
  - `cc23ab0` Layout shell + Linear-style home page (Phase 0a items 2–3)
  - `f1237bc` Privacy + terms pages (Phase 1.A)
  - `d6cd825` Contact form + API + Resend (Phase 1.B) — POST /api/contact with Zod, hourly rate limit, honeypot, plain-text email body. Adds `resend`, `zod`, `kill-port`, `dev:fresh` script.
  - `a84d3a6` Screenshot harness fix
  - (this commit) Wiki: 6 new decisions, 1 lessons-learned, backlog rewrite, brand-foundation supersession banner
- **Flagged for next session (pre-existing risks, not introduced this session):**
  - Nav links to `/tools`, `/consulting`, `/modelling-room` will 404 — those pages don't exist yet. Sendable URL claim from last session was Home-only. Either (a) build placeholder pages, (b) trim nav to Home + Contact until pages exist, or (c) make them anchors on Home.
  - `lib/resend.ts:10–14` throws at module load if `RESEND_API_KEY` or `RESEND_FROM_EMAIL` is missing. `pnpm build` will fail without those env vars set. Safer pattern: lazy validation inside the send call. Defer until Render deploy when we know what env actually looks like in CI.
- **Next:** Phase 1.C (basic SEO/meta + sitemap + robots) is the cleanest unblocker before Phase 0 item 4 (Render deploy) — meta has to be right before pushing the URL anywhere.

## 2026-05-08 — Nav cleanup, no-prices rule, deploy prep

- Trimmed nav to **Home / Contact / Tools** with Tools as a non-link parent dropdown (single child today: AI Readiness Assessment). Mobile dropdown anchors left of the button so it doesn't overflow the 390px viewport; sm+ anchors right. Verified at desktop and mobile, open and closed states. Commit `2ea0a86`.
- Built `/ai-readiness-assessment` landing page (commit `099d3b1`) — disambiguates the free Phase 2 diagnostic ("launching soon") from the two-week paid consulting engagement, with Book-a-call CTA → `/contact`. Initially included `Fixed price $3,000 AUD`; Rob pushed back. Removed the line from the page and the orphan pricing-disclaimer paragraph from `/terms`. Added a CLAUDE.md UI/UX rule: no prices, day rates, or dollar amounts for our services on the site. Saved as feedback memory `feedback_no_prices_on_site.md`. Commit `daec1e0`.
- Refactored `lib/resend.ts` from a top-level-throwing module into a `getResend()` getter that resolves env vars lazily on first call (commit `695a031`). Required for Render's first build before env vars are wired up.
- Extended `scripts/screenshot.mjs` with a `--click=<selector>` flag so the verification harness can trigger interactive UI (toggle menus, expand sections) before capture. Used to verify the Tools dropdown.
- **DB provider switched from Neon to Render Postgres** for single-provider operational simplicity. Decision recorded: `wiki/decisions/2026-05-08-render-postgres-over-neon.md`. CLAUDE.md, .env.example, phase2-ceo-review, backlog, and privacy page all updated. Phase 2 CEO review preserved as historical record (Neon was the documented choice at that decision point); a banner at the top links to the new decision.
- **Next:** push the queued commits to `origin/main`, then walk through Render Web Service + Render Postgres provisioning together (DNS to archoslabs.xyz follows). Phase 1.C SEO/meta after the deploy is live — Slack/LinkedIn cache OG on first share, so it just needs to be right before the URL goes anywhere public.

## 2026-05-08 — Phase 2 spec received + CEO review + Phase 1/2 sequenced in parallel

- Rob delivered the AI Readiness Assessment Product Spec v1.0 (28 pages). Lead-generation engine that converts executives into qualified leads for the $3,000 AUD AI Readiness Assessment consulting engagement.
- Ran CEO-mode review of the spec via `/plan-ceo-review`. Surfaced and challenged 8 premises (three Claude calls, Supabase, print-stylesheet PDF, hard registration gate, 8-second silent wait, fake benchmark bars, 4–6 week build vs revenue deadline, old model id).
- Rob picked **HOLD SCOPE** on the product surface with three surgical reductions accepted: drop benchmark bars, staged progress UI, server-side Puppeteer PDF (replacing `window.print()`).
- Rob clarified that "follow our standards" applied to all of CLAUDE.md, not just the data model naming. Stack swapped from Supabase to Neon + Drizzle + Resend magic-link auth. Single Claude call collapsed from spec's three.
- Phase 1 and Phase 2 build **in parallel**. Phase 1 (~1 week: contact form + SEO + privacy/terms) ships first to unblock revenue; Phase 2 builds alongside (~5 weeks).
- Decision recorded: `wiki/decisions/2026-05-08-phase2-ceo-review.md`.
- Backlog `wiki/backlog/backlog.md` Phase 2 stub (items 14–20) replaced with detailed 5-week sequencing (items 14–25). Verify criteria per CLAUDE.md on every item. Mode, reductions, and stack alignment documented inline.
- Earlier today: admin space request (login/register + user manager + integrations panel for OAuth/Cloudinary/DB connection string) reviewed and **deferred** entirely. Cathedral-of-user-management for one user; integrations panel conflated env-var bootstrap with runtime DB config; no revenue tie. Trigger to revisit: when Phase 2 ships and there are leads/content to manage. Decision recorded: `wiki/decisions/2026-05-08-admin-deferred.md`.
- Hero/footer logo wired earlier in session (700×700 source PNG at `public/images/logo.png`, 36×36 in header and footer). Favicon source saved at `app/icon.png`. Old Next.js scaffold favicon still in place — not yet removed.
- TodoWrite set up to track Phase 1.A → Phase 2.W5 build sequence.
- **Next:** start coding. Phase 1.A (Privacy + Terms pages) is the cleanest first step — pure code, no new dependencies, unblocks contact form's data-collection requirement.

## 2026-05-07 — Linear-quality redesign (supersedes editorial direction)

- Rob asked for Linear.app-quality home page with full spec: dark `#0F0F0F` canvas, `#3B82F6` accent, Inter only (Source Serif 4 dropped), 8pt grid, 1080px max width, 128px section padding, sticky transparent header that gains backdrop blur on scroll, radial gradient on hero, "fail" word in accent.
- Replaced colour tokens (paper→canvas, ink→fg, added surface), removed serif font token, removed Source Serif 4 from `app/layout.tsx`, rewrote header (now `'use client'` with scroll-state), simplified footer to single line, fully rewrote `app/page.tsx` with extracted constants for services/lists/CTA classes.
- New decision recorded: `wiki/decisions/2026-05-07-linear-redesign.md`. Three Phase 0a decisions (brand foundation, layout shell, home page) marked superseded with banners; their copy and structure carry forward, only styling replaced.
- **Bug during session:** Tailwind v4 + Turbopack didn't compile new utility names (`bg-canvas`, `text-fg`) on hot-reload. Body rendered with transparent bg + black text. Diagnosed via `curl` of the served `.css` chunk + `grep` for utility names. Fix: re-save `globals.css` (one comment is enough). Recorded as lesson: `wiki/lessons-learned/2026-05-07-tailwind-v4-new-utilities.md`.
- Verified at desktop (1280x800) and mobile (390x844). Computed body bg `rgb(15,15,15)`, text `rgb(245,245,245)`, h1 64/36px Inter — matches spec exactly. `pnpm tsc --noEmit` clean.
- **Side-fix:** dropped pricing from the home before the redesign, then again confirmed pricing absence in the new design. Hero headline kept ("Most AI programs fail before the model arrives.") with "fail" now rendered in accent blue per spec.
- **Next:** Phase 0 item 4 (Render deploy + DNS to archoslabs.xyz) once Rob signs off on the redesign.

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
