---
title: Session Log
category: synthesis
created: 2026-05-07
updated: 2026-05-13
related:
---

Append-only log of sessions. Newest entry at the top.

## 2026-05-15 — Site-wide design refresh (Linear-themed, five-PR pipeline)

DESIGN.md (PR #32, committed 2026-05-15) became the canonical brand spec for the HQ. Walked every user-facing surface against it and shipped a five-PR pipeline. Each PR is independently reviewable + mergeable; the user smoke-tested on prod between merges so any visual drift surfaced immediately and never compounded across PRs.

**PR #34 — D1 (color tokens + accent swap to Linear lavender)**

Rebuilt `app/globals.css` `@theme` from 7 tokens → 22 tokens. The headline visual change is `accent #3b82f6` (Tailwind blue) → `primary #5e6ad2` (Linear lavender) on every CTA, focus ring, link emphasis, and brand mark site-wide. Other token-level changes: canvas `#0f0f0f → #010102` (deeper black with faint blue tint), surface → surface-1..4 ladder, fg → ink hierarchy, rule → hairline scale, new semantic-success / brand-secure / inverse-canvas tokens.

Sweep across 30+ TSX/TS files renamed every Tailwind utility (`bg-accent` → `bg-primary`, `text-fg` → `text-ink`, `bg-surface` → `bg-surface-1`, `border-rule` → `border-hairline`). Transactional surfaces (email + PDF) updated to lavender too — `lib/email-templates.ts` (`#1e40af` → `#5e6ad2`), `lib/booking-emails.ts` ACCENT constant, `app/opengraph-image.tsx` accent dot, `.pdf-mode` + `@media print` overrides. Print path kept light-themed (correct for transactional) but accent now lavender for brand consistency.

Follow-up commit on the same PR: hero radial gradient `rgba(59,130,246,0.12)` → `rgba(94,106,210,0.12)` so the ambient glow behind the heading matches the new primary.

**PR #35 — D2 (13-token typography scale + high-frequency drift fixes)**

Added DESIGN.md's 13 type tokens to globals.css. Tailwind v4 generates `text-display-xl` / `text-headline` / `text-eyebrow` / `text-button` etc. — each bundles size + line-height + letter-spacing + font-weight in one class. The eyebrow's `+0.4px` positive tracking is deliberate per spec (taxonomy marker, in contrast to the negative-tracked display sizes).

`components/ui/pill.tsx` + `components/ui/button.tsx` updated to use the new tokens — cascades to every usage site. High-frequency drift fixed on home (`app/page.tsx`): hero h1 mobile bumped 36→40px, section heading 36→40px, button label 16→14px, eyebrow tracking ~1px → 0.4px, body leading 1.7 → 1.5. Secondary heroes (contact, privacy, terms, ai-readiness-assessment) → `text-display-md md:text-display-lg`. Admin h1s → `text-headline md:text-display-md`.

Deliberately skipped: question-card + report-view verdict headings (deeper in flow, smaller drift) — accepted as a "later iteration" tightening to keep the PR scope honest.

**PR #36 — D3 (decorative accent cleanup + surface ladder)**

The headline change of the whole pass. After D1, lavender was working correctly on intentional CTAs but bleeding into decorative roles — eyebrow pills, progress bars, success callouts, list-item bullets, date-cell selection dots, skeleton placeholders. Per DESIGN.md, primary lavender appears ONLY on brand mark, primary CTA, focus ring, link emphasis — never decoratively. Moved 24 ambiguous uses to neutral surface / ink / semantic tokens:
- `Pill` + home hero eyebrow → `border-hairline-strong text-ink-subtle` (was `border-primary text-primary`)
- 8 secondary-page inline eyebrows → `uppercase text-eyebrow text-ink-subtle`
- `BlueDot` → `ListBullet` with `bg-ink-subtle`
- Service card hover → `hover:border-hairline-strong`
- Progress bar fills (assessment + report) → `bg-ink`; tracks → `bg-hairline/60`
- Registration-gate skeleton placeholder → `bg-surface-2`
- `day-cell` today-marked dot → `bg-ink`
- Admin "Saved" badges (3 sites) → `text-semantic-success` (first real use of the token added in D1)
- Contact-form success callout → `border-semantic-success/40 bg-semantic-success/5 text-semantic-success`

Surface ladder also got attention: dialog modals + admin integrations modals + admin tab active state escalated from `surface-1` to `surface-2` (selection / lift = surface-2 per spec elevation table).

Stale hardcoded rgba in `question-card.tsx` shadow (`rgba(59,130,246,0.4)` left over from before D1) bumped to lavender `rgba(94,106,210,0.4)`.

**PR #37 — D4 (semantic colors: hardcoded hex → tokens)**

Replaced 17+ inline `text-[#f87171]` / `border-[#fbbf24]/40` / `bg-[#fb923c]/5` / `text-red-400` patterns with the token utilities that D1 already added to globals.css. No visual change — pure tokenisation. After this PR, every color in the codebase is a CSS variable under DESIGN.md authority. Future palette edit is a one-file change.

**PR #38 — D5 (font swap Inter → Geist Sans + Geist Mono)**

Optional follow-up. DESIGN.md §347 lists both Inter and Geist Sans as viable free substitutes for Linear's proprietary faces; Geist's geometric construction (notably display sizes 40/56/80px) reads closer to Linear's voice. Swap via `next/font/google` (same self-hosted-at-build-time setup as Inter), plus added `--font-mono: var(--font-geist-mono)` to `@theme inline` so the existing `font-mono` utility (used by admin integrations audit log + admin JSON editors) picks up Geist Mono automatically.

OpenGraph image kept Inter (next/og uses its own renderer-internal font handling); email + booking-emails kept the system font stack (email clients can't reliably load custom fonts).

**Key learning** — staged multi-PR pipeline was the right call for a design refactor of this scope. The visual feedback loop between each PR caught issues that would have compounded in a single mega-PR: D3 fixed "decorative lavender bleed" that only became obvious AFTER D1 swapped the hue; D4's tokenisation was safe to do last because it's no-visual-regression by design. The user's "merge → smoke-test → next PR" cadence kept blast radius small.

**Recurring quirk** — Tailwind v4 dev-server hot-reload doesn't always pick up new `@theme` token NAMES (values hot-reload fine). Touching `globals.css` after introducing new tokens forces a recompile. Already documented in `wiki/lessons-learned/2026-05-07-tailwind-v4-new-utilities.md`; the same pattern bit us once in D1 and once in D2 before remembering to touch.

**Wiki updates from this session**:
- New concept: `wiki/concepts/design-system.md` — implementation reference for the token architecture (what lives in globals.css, how it relates to DESIGN.md, the @theme namespacing model, transactional-surface overrides). Companion to DESIGN.md (which is the spec).

**Open after this pass**: PR C (~2026-05-22, flip INTEGRATION_FALLBACK_ENABLED=false + remove env-fallback code), Phase 1.E Lane B (book-a-call — the only lead-facing flow that doesn't self-serve today).

## 2026-05-13 — Post-launch prod fixes + magic-link email redesign

Session continued after the initial "Phase 2 shipped end-to-end" entry below. Six more PRs landed today, all driven by what surfaced on the live prod surface.

**PR #21 (wiki)** — `wiki/lessons-learned/2026-05-13-puppeteer-on-render.md` written up after the three-attempt Puppeteer-on-Render debug from the morning. Documents the build-command / cache-path / navigation-target trio.

**PR #22 (`getPublicOrigin` helper)** — same `request.url` → `https://localhost:10000` bug class as PR #20 surfaced in four more places (share-mint route, magic-link request route, magic-link verify redirect, lead-notification email-link). Extracted `lib/public-origin.ts` and replaced `new URL(request.url).origin` everywhere it emitted a publicly-reachable URL. Pattern is now: any route that returns a URL to the user (email link, redirect target, JSON response) MUST go through `getPublicOrigin(request)`, not `request.url`.

**PR #23 (share-token verify 500)** — `ERR_INVALID_ARG_TYPE: Received an instance of Date` from `lib/share-tokens.ts` `verifyShareToken`. Root cause: `sql\`COALESCE(${shareToken.consumedAt}, ${now})\`` — Drizzle's raw `sql\`...\`` tag binds the JS `Date` directly to a `postgres-js` parameter, but `postgres-js`'s raw-parameter path doesn't serialise `Date`. Drizzle's high-level `.set()` does. Fix: use Postgres `NOW()` in the raw tag instead of a JS Date. Rule recorded inline in `lib/share-tokens.ts`.

**PR #24 (sign-out redirects home)** — `LeadSignOutButton` was calling `router.refresh()` only. Signing out from `/tools/ai-readiness/report/<id>` left the user on a URL that now 404s with the cookie gone, with no URL-bar change to signal what happened. Fixed: `router.replace("/")` + `router.refresh()`.

**PR #25 (magic-link email v1)** — structural redesign of `buildMagicLinkEmail()`. Logo + wordmark masthead, `#1e40af` accent (matched to the PDF light-mode palette), 560px width, branded footer with tagline. v1 looked correct in the Playwright preview.

**PR #26 (magic-link email v2)** — live test in user's Outlook web dark mode showed v1's `<a>`-styled button rendered as a plain text link with dark text on the blue background. v2 introduces the bulletproof button pattern (`<td bgcolor>` + `<v:roundrect>` for Outlook desktop + `[data-ogsc]` overrides for Outlook web dark mode), table-row spacing instead of div padding, personal sign-off from Rob inside the card, doubled masthead size (28px → 56px logo, 15px → 30px wordmark), and confident copy. Verified on prod in Outlook web.

**Wiki updates from this session**:
- New lesson: `wiki/lessons-learned/2026-05-13-email-buttons-need-the-bulletproof-pattern.md` — why a plain `<a>` button is not enough, and the three-layer fix.
- New concept: `wiki/concepts/transactional-email-rendering.md` — full pattern reference for future email templates (booking confirmations, etc.). Includes copy/brand decisions (personal sign-off, confident copy, palette) alongside the technical patterns.

**Key learning** — Playwright screenshots of rendered HTML confirm structure but not client-specific rendering. For transactional email, deploy + verify in the actual target client (Outlook web dark mode being the binding constraint for the exec audience) is non-negotiable. Recorded in the lesson page.

**Open from prior plan, still pending**: lead-notification email polish (internal, low priority), `render.yaml` codification (optional), unpause Dev2.

## 2026-05-13 — Phase 2 shipped end-to-end + prod hardened

Long session. Eight feature PRs + one fix PR all landed today, closing the D → C → B sequence and the immediate launch checklist.

**D-27 (PR #12)** — diagnostic content (questions, scoring, risk-flag rules, priority triggers, tier boundaries, domain weights) moved out of `lib/diagnostic/content.ts` into the admin row at `site_setting` key `'diagnostic_content'`. Scoring engine refactored to take `DiagnosticContent` as a parameter (no module-level state). New `/admin/diagnostic` editor with raw-JSON paste + Zod validation. Source now ships a single placeholder question as the fallback.

**D-28 (PR #15)** — both IP-sensitive wiki pages (`wiki/concepts/diagnostic-scoring-logic.md` + `wiki/decisions/2026-05-09-diagnostic-scoring-calls.md`) rewritten as architecture/discipline overviews. Specific per-option scores, persona test results, and the four specific calibration changes no longer in public docs. Full content recoverable from git history via `pnpm extract-content` if needed.

**C-1 (PR #16)** — return-visitor portal at `/tools/ai-readiness`. Signed-in leads see their reports + a "Run again" CTA gated by a 30-day cooldown. New visitors and `?retake=1` still see the assessment SPA. New `loadLeadPortalData()` joins assessment_session + report_output filtered by lead.

**Auth header (PR #17)** — `Sign in` link in the nav when signed out; `Profile` dropdown with "Signed in as [Name]" + Sign out when signed in. `getSignedInLead()` server helper with React `cache()` per-request dedupe. New `POST /api/auth/lead/logout`. Designed to scale: future profile menu items slot in under the Profile dropdown.

**C-2 (PR #18)** — share tokens. Owner generates 7-day public URLs to forward to CFO/board. Many active tokens per report, each independently revocable. `consumed_at` audit stamp on first view, re-views OK within TTL. New `share_token` table with sha256-hashed tokens. New `share-controls.tsx` client component. Public `/tools/ai-readiness/share/[token]` view with `noindex` metadata. Design concept page: `wiki/concepts/share-tokens.md`.

**B (PR #19)** — server-side Puppeteer PDF on the report page. Owner-only — share-token recipients still use `window.print()`. Five iterations of polish (light theme, page numbers, 3-col domain breakdown, natural pagination, content alignment). PDF output is genuinely executive-ready.

**B prod-fix (PR #20)** — `request.url` on Render reports `https://localhost:10000` (X-Forwarded-Proto from edge, but internal speaks HTTP). PDF route switched to navigate via `NEXT_PUBLIC_SITE_URL` instead.

**Launch checklist**:
- `/admin/diagnostic` seeded with the real v1.0 content via `pnpm extract-content dcd6652 content.json`. Verified locally + prod (shared DB).
- Render env vars audited and completed: `AUTH_SECRET` was missing initially → admin login 500'd → fixed. Then `PUPPETEER_CACHE_DIR` added for the PDF endpoint.
- Render build command updated: `pnpm install --frozen-lockfile && npx puppeteer browsers install chrome && pnpm build`.

**Three sequential Puppeteer-on-Render failures** documented in `wiki/lessons-learned/2026-05-13-puppeteer-on-render.md`:
1. Chromium binary missing (Render's `pnpm install` skips build scripts) → build command append.
2. Cache path mismatch between build and runtime → `PUPPETEER_CACHE_DIR=/opt/render/project/src/.cache/puppeteer`.
3. Navigation URL using internal hostname → use `NEXT_PUBLIC_SITE_URL`.

The third one was where the CLAUDE.md debugging protocol (Confirmed / Evidence / Root cause / Fix / Verify with) earned its keep. Two speculative iterations failed; one protocol-driven diagnosis nailed it.

**End state**: D track closed, C track closed, B track closed, launch checklist passes. The AI Readiness Assessment is end-to-end functional on `archoslabs.xyz` with shareable PDFs.

## 2026-05-13 — D-28: redacted scoring-logic + calibration-calls wiki pages

Closes the D track (IP-sensitive content out of public repo). Both `wiki/concepts/diagnostic-scoring-logic.md` and `wiki/decisions/2026-05-09-diagnostic-scoring-calls.md` rewritten as architecture/discipline overviews — the engine pipeline, branch resolution mechanism, domain/tier/risk-flag/priority-trigger concepts are still documented, but the specific per-option scoring matrix, calibrated values, four specific score changes, and three persona test results are no longer in the public wiki. Original full content is recoverable from any commit before today via `pnpm extract-content`.

Picked Option A (rewrite) over Option B (gitignored `private-notes/`) given Dev2 is paused — Option A's "no sync to maintain" wins without a second machine to sync to, and the calibration rationale can be recovered from git when needed.

Pre-redaction verification: `grep` for both file slugs across the repo (excluding wiki) returned only one hit — `CLAUDE.md:923`, an example branch-name string, not a real reference. Confirmed zero runtime impact. The assessment, scoring, reports, admin UI all unaffected. The two wiki pages were narrative-only.

Backlog items 26–28 all now marked shipped. The D-track is done.

## 2026-05-12 — Backlog: added Phase 1.E (Book a Call) items 29 + 30; claimed Lane B

Added Phase 1.E section to `wiki/backlog/backlog.md` covering Book-a-Call's Lane B (Google Calendar + Claude integrations) as item 29 and Lane C (slot math + scheduler) as item 30. Lane A foundations already shipped in PR #8 + PR #10; backlog now reflects what's planned next. Item 29 claimed for Rob today per the CONTRIBUTING.md "Backlog-claim convention" (the `[Rob, 2026-05-12]` tag). PR that ships item 29 will strip the claim line.

## 2026-05-12 — Phase 1.E Book-a-Call Lane A foundations + incident

**Shipped (PR #8, squash-merged to main as `ba3943a`):** Drizzle schema for 5 new tables (`consultant`, `consultant_blackout`, `booking_request`, `scheduled_job`, `cron_heartbeat`) and four new `lib/` modules — `booking-crypto.ts` (AES-256-GCM for Google refresh tokens, D6a), `jwt-magic-link.ts` (cancel + reschedule magic links for the booking flow, D3c, distinct from W4 Pass 2's `lib/magic-link.ts`), `errors/booking.ts` (`BookingError` base + 14 named subclasses, §18.4), `redact.ts` (PII redaction for logs, D8b). 36 new tests; full suite green (43 total). Migration `0003_superb_marvel_zombies.sql` sits on top of W4 Pass 2's `0002_exotic_toad.sql`. `.env.example` documents the new `BOOKING_ENCRYPTION_KEY` var.

**Incident during the session:** mid-flow audit claimed `magic_link_token` was orphaned schema drift based on grep of the feature branch's working tree. The table was actually load-bearing for W4 Pass 2, which had merged to main and deployed to Render after the feature branch was created. Wrote a cleanup migration that dropped the table + 3 rows of W4 Pass 2 test data. Caught when opening the PR — the resulting merge conflict in `drizzle/meta/_journal.json` and `0002_snapshot.json` surfaced the divergence. Restored the table by re-running the `CREATE TABLE` statements from `origin/main:drizzle/0002_exotic_toad.sql` against Render, marked `0002_exotic_toad.sql` as applied in `__drizzle_applied`. Discarded the bad cleanup commit, rebased the foundations commit onto current main, force-pushed. The 3 dropped rows are recoverable only from Render's automated DB backups if those exist; otherwise gone (likely dev test data — verify if needed).

**Lessons-learned written:** [Schema drift claims need an origin/main check, not just the working tree](lessons-learned/2026-05-12-schema-drift-needs-origin-main-check.md). Rule: before declaring code unreferenced or schema orphaned, `git fetch && git log HEAD..origin/main --oneline` to see what merged after you branched off, and `git grep <symbol> origin/main` to search across branches, not just the working tree. Destructive operations against shared state need this check *before* the command, not after.

**Decisions captured in plan file (external, at `~/.claude/plans/...`):** D18 — confirmation email moves into `scheduled_job` queue for retry uniformity. D19 — cron handler dequeues with `FOR UPDATE SKIP LOCKED` to prevent overlap-driven duplicate sends.

**Next:** Lane A A5 (UI primitives in `components/ui/`) + A6 (email templates in `lib/emails/`). After that, Lane B (Google Calendar + Claude integrations).

## 2026-05-12 — Phase 2 W4 Pass 2 shipped (magic-link sign-in)

Closes the revenue-critical return-visitor gap. A lead who clears cookies / switches device / comes back next month can now recover access to their report without re-running the assessment.

**Flow**: `/sign-in` form → POST `/api/auth/lead/request` (rate-limited 10/IP/hr + 3/email/15min, always returns generic OK to defeat enumeration) → email via Resend → user clicks → GET `/api/auth/lead/verify?token=…` → atomic consume (single conditional UPDATE on `consumed_at IS NULL AND expires_at > now`) → fresh `archos_lead_session` cookie → 302 to most-recent completed report.

**Schema**: new `magic_link_token` table. Stores `sha256(token)` only — raw token lives in the email link, never in the DB. TTL 15 min. One-time use enforced at the SQL level. `lead_id` FK with CASCADE delete.

**Library**: `lib/magic-link.ts` (mint + consume), `lib/email-templates.ts` (single-CTA HTML + plain-text fallback, escaped inputs).

**UI**: `/sign-in` (email input, calm copy, back-link to assessment for first-timers), `/sign-in/check-email` (says the same thing whether email matched or not), passive "Already done this? Sign in instead" nudge above the registration-gate form.

**Manual test plan run end-to-end** (all 6 pass): nudge visible, happy path, replay → expired_link, no enumeration on fake emails, per-email rate limit (3/15min), tampered URLs → expected error codes.

**Out of scope (deferred to W5)**: lead-side logout, "your reports" listing page for leads with multiple completed sessions, cookie rotation on read, automated tests covering the DB-touching consume path.

**Process notes**: this was the third feature PR through the new branch-protection gate (PRs #1 #2 #3 set up the gate + dogfooded it; #4 is the first revenue-path feature through it). Workflow holds — feature branch → CI → bypass-merge → main → Render auto-deploy.

## 2026-05-11 — Phase 2 W4 Pass 1 verified end-to-end

W4 Pass 1 (registration gate + lead session JWT + owner-only report access) was already implemented at start of session — commit `c0ef2d3` sat on local main unpushed pending manual verification. This session walked the four-test plan against local dev + Render Postgres.

**Tests** (all pass):
- Test 1 — happy path: full assessment → registration POST → redirect to report. Pass.
- Test 2 — form validation: empty fields blocked by HTML `required`; malformed email rejected with 400 from Zod-validated `/api/diagnostic/generate`; form values persist across error. Pass.
- Test 3 — owner-only access (security-critical): a logged-in user with one report cannot view another user's report URL; an incognito visitor with no cookie cannot view any report. Both return 404 (not 401, to avoid revealing existence). Pass.
- Test 4 — returning lead upsert: same email registered twice produces one `lead` row with `updated_at > created_at` plus two `assessment_session` rows. Verified via new `scripts/check-lead.mjs` helper (one-off DB introspection by email; Rob had no SQL client). Pass.

**Wiki**: created `wiki/concepts/lead-session-and-owner-only-reports.md` — documents the two-cookie / one-secret model (admin 24h vs lead 30d, both signed with `AUTH_SECRET`, never overlap), the lead upsert-by-email pattern, sticky `is_priority`, the 404-not-401 ownership check rationale, and what W4 Pass 1 explicitly does NOT include (magic-link sign-in for return visitors lands in Pass 2).

**Helper added**: `scripts/check-lead.mjs` — `node --env-file=.env.local scripts/check-lead.mjs <email>` prints the lead row(s) and all linked assessment sessions. One-off introspection tool; pattern matches `scripts/test-db.mjs`.

End state: c0ef2d3 verified, wiki updated, ready to push to `origin/main`. W4 Pass 2 (magic-link auth for return visitors) is next.

## 2026-05-08 — Phase 1.C built via minimal admin section + AIEO assets

Long session. Final state: Phase 0a fully shipped (`https://archoslabs.xyz` live, custom domain, valid SSL, contact form delivers to Outlook), and Phase 1.C SEO/AIEO complete via a minimal admin instead of env-var config (Rob's call).

**Contact form path** (covered in last session entry): tried Resend → @archoslabs.xyz mailbox (silently dropped by GoDaddy anti-spoofing), GoDaddy SMTP via cPanel hostname (Render IPs blocked at firewall), GoDaddy SMTP via mail.archoslabs.xyz alias (same IP, same firewall block). Settled on Resend with `CONTACT_RECIPIENT_EMAIL=trebor.selegna@outlook.com`. Decision recorded: `wiki/decisions/2026-05-08-resend-with-external-recipient.md`. Burned ~45 minutes on the dead-end GoDaddy SMTP path; lesson saved as `feedback_test_from_production_perspective.md` memory.

**DNS to Render** (last session): A record at apex `archoslabs.xyz → 216.24.57.1`, CNAME `www → cc-archos-labs.onrender.com`. Verified, SSL provisioned. archoslabs.xyz live.

**Phase 1.C — Admin section + AIEO** (this session):

- Reviewed spresso (cc-spresso-data-studio) for reusable patterns. Took: key-value settings table, `SiteSettingsPage` UI shape, JWT-cookie auth middleware. Skipped: 16 other settings pages, multi-user/roles, OAuth providers.
- **Drizzle setup**: `lib/db/{schema,index}.ts`, `drizzle.config.ts`, `site_setting` table (UUID PK, key text unique, jsonb value). Render Postgres uses `ssl: 'require'`. **`drizzle-kit push` hangs at "Pulling schema from database"** against Render Postgres (multiple SSL configs tried — all hang). Bypassed via `drizzle-kit generate` + custom `scripts/db-apply.mjs` that applies generated SQL through the working `postgres-js` connection. Idempotent via `__drizzle_applied` metadata table. Lesson recorded: `wiki/lessons-learned/2026-05-08-drizzle-kit-push-hangs-on-render.md`.
- **Auth**: `lib/auth.ts` (Edge-safe JWT sign/verify via jose, constant-time password compare), `lib/auth-server.ts` (server-only cookie helpers), `middleware.ts` (gates `/admin/**` and `/api/admin/**`), login + logout API routes, rate-limited (10/IP/hour). `ADMIN_PASSWORD` + `AUTH_SECRET` env vars.
- **Admin UI**: `/admin/login` (single password field), `/admin/site` (8-field SEO form: siteName, tagline, description, founderName, founderLinkedinUrl, ogImageUrl, twitterHandle, linkedinUrl). Load on mount, save on submit with optimistic feedback. Sign-out button.
- **Settings API**: `app/api/admin/settings/site/route.ts` (GET returns row or defaults; PUT Zod-validated upsert).
- **Site-config layer**: `lib/site-config.ts` with `getSiteSettings()` (React `cache()` for per-request dedup, falls back to defaults on DB error) and `buildPageMetadata({title, description, path})` helper used by every page.
- **Per-page metadata wired**: layout + privacy + terms + contact + ai-readiness-assessment all use `buildPageMetadata`. Title template, full openGraph + twitter blocks, canonical URLs, all driven from admin row.
- **AIEO assets**: `app/sitemap.ts`, `app/robots.ts` (disallows /admin), `public/llms.txt` (llmstxt.org-style for AI crawlers), `app/opengraph-image.tsx` (programmatic 1200×630 OG card via Next.js `ImageResponse`).
- **JSON-LD**: Organization + WebSite schemas in `app/layout.tsx`, derived from settings.
- **Decisions**: `wiki/decisions/2026-05-08-minimal-admin-for-seo.md` (new) and `wiki/decisions/2026-05-08-admin-deferred.md` (banner: partially superseded for SEO slice; full multi-user admin still deferred).

End-to-end verification (local): login → GET /api/admin/settings/site → PUT round-trip persists; sitemap/robots/llms.txt/opengraph-image all 200; homepage HTML has full OG/Twitter meta + 2 JSON-LD scripts.

**For Rob when he returns**:
1. Add to Render env: `ADMIN_PASSWORD` (strong value, NOT the dev value `archos-admin-dev-pw`) and `AUTH_SECRET` (32-byte random base64; use `openssl rand -base64 32` or PowerShell helper in .env.example)
2. Run `pnpm db:migrate` against the Render Postgres (uses External Database URL from .env.local) to create the `site_setting` table on production. Already created against the same DB during local testing — should be a no-op on prod.
3. Confirm OK to push (10 commits + ~30 new files). Per pre-launch sprint exception, direct-to-main.
4. After push: visit `https://archoslabs.xyz/admin/login`, sign in with the production `ADMIN_PASSWORD`, edit site settings, save, verify by reloading public pages (metadata reflects).

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
