---
title: Wiki Index
category: synthesis
created: 2026-05-07
updated: 2026-05-18
related: [[state]], [[backlog]], [[shipped]], [[book-a-call-architecture]], [[booking-prompts-in-db]], [[claude-eval-suites]], [[lead-session-and-owner-only-reports]], [[magic-link-sign-in]], [[transactional-email-rendering]], [[integration-config]], [[design-system]]
---

Master catalog of all wiki pages. Read this at the start of every session. For current ship state by route / endpoint / component, read [[state]] first (auto-generated, always fresh).

## entities
- [About page](entities/about-page.md) — `/about` route; practitioner dossier composed from the home + about section primitives. Anchors Rob as the credibility surface a sceptical exec lands on before the assessment or call.

## concepts
- [AI Readiness Assessment — Scoring Logic](concepts/diagnostic-scoring-logic.md) — engine architecture: pipeline, branch resolution, domain weighting, tier derivation, risk flags, priority triggers; calibrated values live in /admin/diagnostic
- [Lead session model and owner-only report access](concepts/lead-session-and-owner-only-reports.md) — two cookies one secret, lead upsert by email, sticky priority, why owner-mismatch returns 404 not 401
- [Magic-link sign-in for return visitors](concepts/magic-link-sign-in.md) — sha256-stored tokens, atomic single-UPDATE consume, no enumeration on any surface, latest-report-wins on verify
- [Share tokens for the AI Readiness report](concepts/share-tokens.md) — 7-day TTL public URLs, one-consume-stamp/re-views-OK semantics, many-active-per-report, atomic verify via COALESCE on consumed_at
- [Transactional email rendering — patterns and brand decisions](concepts/transactional-email-rendering.md) — bulletproof button (table + VML + [data-ogsc]), table-row spacing, masthead-outside-card, personal sign-off, palette matched to PDF light-mode tokens
- [Integration config — DB-backed secrets with env-rooted master key](concepts/integration-config.md) — AES-256-GCM per-field encryption in `site_setting`, fail-closed loader, module-level cache, env-fallback grace window, master-key rotation
- [Design system — implementation reference](concepts/design-system.md) — how DESIGN.md flows into globals.css `@theme`, the 22 colour + 13 typography tokens, surface ladder, transactional-surface overrides, rules-of-thumb for adding new tokens
- [Claude eval suites for booking prompts](concepts/claude-eval-suites.md) — pnpm eval, fixture-based programmatic checks across the 3 booking prompts, live API calls, kept out of CI
- [Book-a-Call architecture](concepts/book-a-call-architecture.md) — full pipeline overview: prospect → booking page → Google Calendar event + Resend confirmation → cron-driven reminders + Claude pre-call brief → magic-link manage flow; soft-fallback semantics, schema, what's deliberately not shipped
- [Booking prompts in the DB — soft-fallback by design](concepts/booking-prompts-in-db.md) — three Claude prompts (followup, brief, blogMatch) in one `booking_prompts` site_setting row; admin edits at /admin/prompts; soft-fallback to hardcoded starters when row missing/malformed (vs diagnostic's hard-fail)
- [Home page section components — reusable pattern](concepts/home-page-section-components.md) — 10 reusable section components (Hero, Section, CtaPair, ProofItem, ServiceCard, AudienceList, Timeline, ObjectionFaq, AnchorNav, StickyMobileCta) extracted in PR #53; pattern is the foundation for the Consulting page, Modelling Room, and Tools index
- [About page section components](concepts/about-page-section-components.md) — 4 bio-oriented primitives (PersonCard, PhilosophyBlock, WayOfWorkingSteps, SelectedWorkCard) introduced for `/about`; companion family to home — together they are the design system's vocabulary for public-facing content pages

## decisions
- [Data retention policy + enforcement](decisions/2026-05-18-data-retention-policy.md) — 30-day IP/UA purge + 24-month inactive-lead purge; constants hardcoded (not Settings) to prevent drift from `/privacy` text; explicit two-step DELETE because `assessment_session.lead_id` is `SET NULL` by design
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
- [Home page (`/`) — Phase 0a structure and copy](decisions/2026-05-07-home-page.md) — _superseded by the May 2026 PAS rewrite_; the four-section structure has been replaced
- [Home page PAS rewrite — May 2026](decisions/2026-05-17-home-page-pas-rewrite.md) — 9-section sales page (Hero → Agitate → Solution+Proof → Timeline → Services → Objection FAQ → Who We Work With → Assessment Block → Final CTA), dual CTA, sticky mobile CTA bar, ?name=-driven print personalisation; componentised into `components/sections/home/`
- [About page — May 2026 CEO review + locked decisions](decisions/2026-05-18-about-page.md) — `/about` route; 4 locked decisions (D1 new components/sections/about/ family; D2 SCOPE EXPANSION mode; D3 omit hero CTAs + generalise <Hero> cta prop; D4 Selected Work between Person and Philosophy); 8 expansions accepted (Schema.org Person, OG card, anchor nav, sticky mobile, pull-quote, photo placeholder, ?name=, Selected Work strip, LinkedIn + Modelling Room outbound links)
- [Patch-in-place reschedule (events.patch over delete + create)](decisions/2026-05-17-patch-in-place-reschedule.md) — reschedule moves the existing Google event via PATCH rather than delete-old + create-new; preserves event id, fires a single "Event updated" notification, avoids Google's invite-suppression on rapid cancel+create pairs
- [events.insert uses sendUpdates=all](decisions/2026-05-17-send-updates-all-on-events-insert.md) — without it, attendees get no .ics invite email; bookings ship both Google's native invite AND our branded Resend confirmation
- [consultant.public_email split from internal routing](decisions/2026-05-17-public-email-split.md) — `consultant.email` is the OAuth identity + From: header; `consultant.public_email` is what the booking page surfaces; falls back to `email` when null
- [Booking prompts soft-fallback (vs diagnostic's hard-fail)](decisions/2026-05-17-soft-fallback-for-booking-prompts.md) — booking is operational AI augmentation, not a deliverable; missing/malformed prompts row → hardcoded starter, never throw; diagnostic prompt does the opposite for a reason
- [Assessment scoring calibration v1.1 + spec bump](decisions/2026-05-17-assessment-scoring-calibration.md) — five-change retune (Q9a, Q3, Q6 score corrections + Q12a new question with priority trigger + Q1 sector removed from scoring); source-of-truth JSON committed at scripts/diagnostic-content.json

## synthesis
_(none yet)_

## lessons-learned
- [Email CTA buttons need the bulletproof pattern from the first attempt](lessons-learned/2026-05-13-email-buttons-need-the-bulletproof-pattern.md) — Outlook desktop strips display:inline-block on `<a>`; Outlook web dark mode rewrites `<a>` color after inline styles resolve; only `<td bgcolor>` + VML + `[data-ogsc]` overrides survive both
- [Puppeteer-on-Render setup needs three things, not one](lessons-learned/2026-05-13-puppeteer-on-render.md) — build command must run `npx puppeteer browsers install chrome`; cache path must be project-local via `PUPPETEER_CACHE_DIR`; navigation target must use `NEXT_PUBLIC_SITE_URL`, not `request.url`
- [Schema drift claims need an origin/main check, not just the working tree](lessons-learned/2026-05-12-schema-drift-needs-origin-main-check.md) — fetch + diff against origin/main before declaring code or tables unreferenced; a feature-branch grep doesn't see what merged to main after you branched off
- [drizzle-kit push hangs on Render Postgres](lessons-learned/2026-05-08-drizzle-kit-push-hangs-on-render.md) — bypass push; use `drizzle-kit generate` + a `postgres-js` SQL applier
- [Google events.insert needs sendUpdates=all to email the .ics invite](lessons-learned/2026-05-17-google-send-updates-required-for-ics.md) — without it, the event lands on the calendar but no attendee invite goes out; always test with attendee != calendar owner
- [Google suppresses rapid invite + cancel pairs on the same attendee](lessons-learned/2026-05-17-google-suppresses-rapid-invite-cancel.md) — delete-old + create-new for reschedules silently drops the new invite email; use events.patch instead
- [Turnstile needs BOTH keys set — half-config silently breaks](lessons-learned/2026-05-17-asymmetric-turnstile-config.md) — Site Key alone or Secret alone produces a form that submits an empty token to a server that demands verification; require both before treating Turnstile as enabled
- [Vitest retry:2 is the right pattern for live-API eval suites](lessons-learned/2026-05-17-vitest-retry-for-live-api-evals.md) — eval cases mix transient API noise with real regressions; 3 total attempts filter the noise without masking the signal
- [Turbopack workspace root must be set explicitly on Next.js 16](lessons-learned/2026-05-07-turbopack-root.md) — set `turbopack.root` in `next.config.ts` from day one when project lives inside a shared parent dir
- [Tailwind v4 dev server doesn't always compile new utility names on hot-reload](lessons-learned/2026-05-07-tailwind-v4-new-utilities.md) — re-save `globals.css` after introducing new `--color-*` tokens; values hot-reload, names don't

## raw-index
_(none yet)_

## runbooks
- [Rotate the master encryption key](runbooks/rotate-master-key.md) — UI + CLI paths, half-fail recovery, post-compromise rotation of underlying secrets
- [Reset the admin password](runbooks/reset-admin-password.md) — local-laptop CLI path, no-checkout psql path, master-key-also-lost recovery
- [Remove env vars from Render dashboard after migrating to DB](runbooks/env-removal-checklist.md) — pre-flight checks, one-at-a-time removal procedure, 7-day cutover finalisation

## backlog
- [Archos Labs HQ — Build Backlog](backlog/backlog.md) — prioritised build list, ordered by what unblocks revenue and reduces risk (describes **intent**; for ship state read [[state]])
- [Shipped Backlog Items](backlog/shipped.md) — historical record of items moved out of the backlog once shipped; indexes Phase 0 / 1 / 1.E / 2 / 2.5

## state
- [Project state — auto-generated](state.md) — **source of truth for ship state.** Read this before claiming any route, API endpoint, or component does not exist. Regenerated on every commit touching `app/` or `components/` via `scripts/wiki-state.mjs`.
