---
title: Archos Labs HQ — Build Backlog
category: synthesis
created: 2026-05-07
updated: 2026-05-21
related: [[index]], [[log]], [[state]], [[shipped]], [[2026-05-08-phase2-ceo-review]], [[2026-05-20-translation-layer-public-render]], [[2026-05-20-phase-c-cutover]]
---

Prioritised build list for the Archos Labs HQ at archoslabs.xyz. Ordered by what unblocks revenue and reduces risk, not by what is most fun to build.

**This file describes intent — what we plan to build.** For what is currently shipped, read [[state]] (auto-generated from the filesystem). For the historical record of items that moved out of this file, see [[shipped]]. Backlog narratives marked `✅ SHIPPED` below are kept for context; the canonical "is it built?" answer always lives in [[state]].

## Prioritisation rules

1. **Revenue first.** The Consulting track is available immediately — anything that converts a visitor into a consulting conversation outranks anything else.
2. **Foundation before features.** Layout, brand, and deploy pipeline must exist before any page is credible.
3. **Simplest credible thing first.** Per CLAUDE.md "Simplicity First" — ship the minimum that earns trust, not the maximum that demonstrates effort.
4. **High-risk, high-leverage things get scoped early but built late.** The Executive AI Diagnostic is the medium-term lead engine but it is the most complex build. Foundation must be solid first.
5. **Every item has a verify criterion.** Per CLAUDE.md "Goal-Driven Execution".

---

## Phase 0 — Ship credible, then harden

**Reordered 2026-05-07 per Rob's feedback:** with an 11-day revenue deadline, a sendable URL beats a CI pipeline. Build the credible artifact first, deploy it, then harden. Items 1–4 are the critical path to a public, sendable Home page. Items 5–8 harden once it exists. Item 8 (wiki scripts) can be parallelised any time.

1. **Brand foundation** — typography scale, colour tokens, spacing scale defined via Tailwind v4 `@theme` in `app/globals.css`. No stock components, no marketing template. Verify: a single styled `<h1>` + paragraph on `/` reflects the system.
2. **Layout shell** — `components/layout/{header,footer,nav}.tsx`. Mobile-first. Nav links to the four HQ sections (Home, Tools, Consulting, Modelling Room). Verify: shell renders on `/` and persists across route changes.
3. **Home page (`/`) with consulting CTA** — Who we are. What we solve. Who we work with. The filter that tells the wrong client to leave. One clear primary CTA: "Engage Consulting" (initially mailto: or anchor to a forthcoming form). Voice per CLAUDE.md: direct, no corporate speak. Verify: a skeptical first-time visitor can answer "what is this and is it for me?" in under 10 seconds; page is sendable to a prospect.
4. **Render deploy wiring + custom domain** — repo connected to Render, build + start commands set, `PORT` env var honoured, `archoslabs.xyz` pointed at Render. Verify: pushing to `main` auto-deploys and `https://archoslabs.xyz` serves the Home page.

   ↑ **Phase 0a complete here:** sendable URL exists. Revenue can start flowing. Below this line is hardening.

5. **CI pipeline (GitHub Actions)** — `pnpm install --frozen-lockfile`, lint, `tsc --noEmit`, `vitest`, `pnpm build`. Verify: green check on the next push to `main`.
6. **Test framework setup (Vitest)** — install, configure, one trivial passing test. Verify: `pnpm test` exits 0. (Required by item 5.)
7. **Pre-commit hooks (Husky + lint-staged)** — lint + format on staged files. Verify: a deliberately bad commit is blocked locally.
8. **Wiki tooling scripts** — `scripts/wiki-search.mjs` and `scripts/wiki-graph.mjs` per CLAUDE.md "Wiki tooling" section. Currently referenced in CLAUDE.md but not present. Parallelisable with anything in Phase 0. Verify: each documented command runs and returns expected output on the current wiki.

---

## Phase 1 — Revenue Now (consulting pipeline)

The pieces that turn a stranger into a paid consulting conversation. Home page already exists from Phase 0; this phase deepens conversion.

9. **Consulting page (`/consulting`)** — Three service lines (AI Readiness Assessment, Data Architecture, AI Agent Development). Day rate ($1,100 AUD) and fixed price ($3,000 AUD AI Readiness Assessment) shown plainly. How to engage. Verify: a visitor can identify the right service line and the next step without scrolling twice.
10. **Contact endpoint (`POST /api/contact`)** — name, email, organisation, message. Server-side validation, rate-limited (100/IP/hour per CLAUDE.md), secure-by-default. No DB yet — initial implementation can email via Resend or write to a server log. Verify: integration test for happy path + 400 on bad input + 429 on rate-limit; a real submission lands somewhere Rob will see it.
11. **Contact form UI** — embedded on Home + Consulting. Plain-language errors, intentional loading state, success state that doesn't feel like a dead end. Verify: E2E test submits the form successfully on mobile width.
12. **Basic SEO + meta** — title, description, Open Graph image, robots, sitemap. archoslabs.xyz must look credible when shared. Verify: `view-source` shows correct meta on `/` and `/consulting`; OG renders correctly in a Slack/LinkedIn preview test.
13. **Privacy + terms pages** — short, plain-language, honest. Footer links. Required before collecting any contact data per CLAUDE.md privacy stance. Verify: pages exist, footer linked, no legal placeholders.

**Phase 1 ships when:** a stranger can find archoslabs.xyz, understand the offer, and book a consulting conversation in under 2 minutes.

---

## Phase 2 — Lead Gen (AI Readiness Assessment) — ✅ SHIPPED 2026-05-13

**Status:** Items 14–25 inclusive shipped. Live at `/tools/ai-readiness`. See [[shipped]] for the index entry and [[state]] for the live route + endpoint list. The narrative below is kept for historical context — design rationale, CEO review decisions, deviations from spec — but the canonical answer to "is this built?" is [[state]].

**Supersedes the previous stub (items 14–20).** Now driven by the v1.0 product spec (28pp PDF, 2026-05-08) and the CEO review decision recorded in [[2026-05-08-phase2-ceo-review]]. Built **in parallel** with Phase 1 per Rob's sequencing call.

**Mode:** HOLD SCOPE on the spec's product surface. Three surgical reductions:
- Drop sector benchmark bars (fake numeric data is a credibility hole; replace with verdict statement only)
- Replace 8-second silent wait with staged progress UI
- Server-side Puppeteer PDF instead of `window.print()` print-stylesheet

**Stack alignment with CLAUDE.md (overrides spec):** Render Postgres + Drizzle (not Supabase — see [[2026-05-08-render-postgres-over-neon]] for why Render Postgres over Neon), Resend with magic-link auth (not Supabase Auth), `claude-sonnet-4-6` (not the deprecated `claude-sonnet-4-20250514`), snake_case singular tables with FK indexes, 2NF strict.

**Other deviations from spec:** single Claude call returning structured JSON `{verdict, narrative, action_plan}` instead of three concurrent calls (lower cost, no incoherence risk, simpler retry logic).

### 5-week sequencing

14. **Diagnostic content authored as data** — All 12 base questions + 7 branch questions + scoring weights + risk flag rules + tier definitions in a single TypeScript module (`lib/diagnostic/content.ts`), reviewable as data not code. Verify: Rob reads end-to-end and signs off; question IDs match the spec.
15. **DB schema (Render Postgres + Drizzle)** — `assessment_session`, `report_output`, `lead` tables per CLAUDE.md naming standards (snake_case singular, `id uuid pk`, FK indexes, 2NF, `created_at`/`updated_at` on every table). Migration in `drizzle/`. Verify: `drizzle-kit push` succeeds against the Render Postgres dev DB; `pnpm tsc` clean.
16. **Assessment UI (`/tools/ai-readiness`)** — Single-page application, one question at a time, large tap-target answer cards (not radios), branch logic per spec, progress bar, no auth gate yet. Framer Motion for question transitions (<150ms). Verify: full flow completable on mobile (390px) in under 7 minutes; all branch combinations reachable.
17. **Scoring engine (`lib/diagnostic/scoring.ts`)** — Pure functions: score each answer 0–3, compute domain scores (Data Foundation 50% / Program Readiness 30% / Org Reality 20%), derive tier (Critical / Emerging / Developing / Advanced), evaluate risk flag rules. Unit tested. Verify: tests cover tier boundaries, all-best/all-worst paths, every branch question, every risk flag rule from spec §5.3.
18. **LLM client (`lib/model.ts`)** — Single Claude call (collapsed from spec's three) returning structured JSON `{verdict, narrative, action_plan[]}`. Anthropic SDK with prompt caching on system prompt. Retries with exponential backoff. Fallback to deterministic template report on persistent failure. Never logs answer content. Verify: live API call returns valid JSON shape; intentional API failure produces fallback report; key never in client bundle.
19. **Report generation (`POST /api/diagnostic/generate`)** — Wires answers → scoring → single Claude call → DB write. Rate limited (100/IP/hour per CLAUDE.md). Returns session ID. Verify: integration test for happy path + 429 on rate limit + fallback path on simulated Claude failure; pen-test for prompt injection on registration free-text fields.
20. **Magic-link auth (Resend)** — Email-based magic-link sign-in. No passwords, no Supabase Auth. Token TTL 15 minutes, single-use, signed JWT in httpOnly cookie. Verify: link arrives, click signs user in, second click on same link 401s; token cannot be replayed.
21. **Registration gate UX** — Full-screen overlay AFTER final question. Report blurred behind via `backdrop-filter`. Fields: first/last name, work email (validated), job title, organisation, phone (optional). Magic link sent on submit; account created; gate dismisses on token verify. Staged progress copy ("Reviewing your answers..." → "Drafting your report..." → "Almost ready...") replaces 8-second silent wait. Verify: gate cannot be bypassed via URL manipulation; report only renders for owning session.
22. **Report page (`/tools/ai-readiness/report/[session-id]`)** — Verdict header, risk flags (max 3, severity-ordered), domain score cards (NO benchmark bars per CEO reduction), Claude narrative (400–500 words), priority actions (3–5, sequenced), CTA block adapting tone to Q12 urgency. SSR. Owner-only via session check. Verify: skeptical-CDO review of one real report passes "would I forward this to my CFO" test.
23. **Server-side PDF (Puppeteer)** — Renders the report page to PDF via headless Chromium. 6-page structure per spec §8.2 (cover + executive summary + analysis + actions + about). Verify: PDF download works in Chrome/Safari/Firefox; printed output matches on-screen rendering for visible content; under 3s generation time.
24. **Lead webhook (Notion or Airtable — Rob picks)** — On registration, write lead record (name, email, org, title, sector, role_type, maturity_stage, urgency_flag, score, tier) to destination. `urgency_flag = 'mandate'` triggers `is_priority = true`. Verify: real registration produces a row Rob sees in his destination within 60 seconds.
25. **Return-visitor portal + retake + share tokens** — `/tools/ai-readiness` for a logged-in user shows previous report with a "Retake" button (disabled until 30 days from last). Comparison view across reports. Share-token generation (7-day TTL, `noindex` headers, single-use revocable). Verify: returning user sees their report; retake disabled before 30 days; share token works once then 410s.

### Week-by-week mapping

| Week | Items | Outcome |
| --- | --- | --- |
| W1 | 14, 15 | Content as data + DB schema migrated to Render Postgres |
| W2 | 16, 17 | Working assessment UI + scoring engine (no LLM, no auth) |
| W3 | 18, 19 | Single Claude call wired with retries + fallback; static report renders |
| W4 | 20, 21, 22 | Magic-link auth + registration gate + owned report page |
| W5 | 23, 24, 25 | PDF + CRM webhook + return-visitor portal + share tokens |

**Phase 2 ships when:** a cold visitor can complete the assessment, register, receive a specific Claude-generated report, download it as PDF, and convert to a paid consulting call — without human in the loop. Lead lands in CRM. Return visitor sees previous report.

---

## Phase 3 — Growth (publication + brand)

**Status update 2026-05-20:** The publication side of Phase 3 shipped as the **Translation Layer** at `/blog` (253 migrated posts, full AIEO chrome, admin toggle, top-nav link). Items 21 and 24 below are superseded by [[2026-05-20-translation-layer-public-render]] + the new Phase 3 follow-ups section further down. Items 22 (Tools index) and 23 (Analytics) remain open. Translation Layer architectural detail: [[translation-layer]] and [[deployment-architecture]].

21. **Modelling Room page (`/modelling-room`)** — ⚠️ **SUPERSEDED.** The locked architectural decision is that The Modelling Room stays a LinkedIn-native newsletter (separate channel, no on-site page); The Translation Layer at `/blog` is the owned publication surface. See [[translation-layer]].
22. **Tools index (`/tools`)** — Executive AI Diagnostic listed; placeholder for future tools. Verify: page exists, structured for additions.
23. **Analytics** — privacy-respecting (Plausible or similar). Track conversion funnel: visit → contact submit, visit → diagnostic complete, diagnostic complete → call booked. Verify: events fire on staging. **(Moved into Phase 3 follow-ups below as item 41 with current context.)**
24. **Newsletter signup** — ⚠️ **SUPERSEDED** by Translation Layer Phase D item 35 (newsletter capture wired to the `/blog` surface, double-opt-in via Resend, `newsletter_signup` table — schema already shipped in PR #61). See Phase 3 follow-ups below.

---

## Cross-cutting (every phase)

- **Security review** before merging any feature touching user input or external APIs (CLAUDE.md OWASP categories).
- **Wiki updates** before any feature is marked complete (CLAUDE.md `wiki/` mandate).
- **Lessons learned** entries for any non-obvious bug fix or architectural decision.
- **No DB** until a feature genuinely requires persistence — defer until lead capture or diagnostic submissions need it. When added, follow CLAUDE.md Database Design Standards (2NF, indexed FKs, naming conventions).

### Open housekeeping (added 2026-05-20)

These are small, standalone, can be picked up in spare minutes:

- **`/about` photo decision** — `/about` page still uses the original `/images/about-me.png` (1856×2304 portrait) while the Translation Layer Written By card uses `/images/ran-square.png` (737×739 square) which crops cleanly to the circular avatar. Decide whether to swap `/about` to the square too (one-line code change in `app/about/page.tsx` const `PHOTO_SRC`), keep both, or replace the portrait file. Currently the two photos are different headshots — readers visiting both surfaces see two different Robs.
- **Tense update on `wiki/decisions/2026-05-19-translation-layer-migration.md`** — reads as future-tense plan even though Phases A1, A4, B, C are all shipped. Either rewrite to past-tense + cross-link to the Phase B / Phase C decision docs, or leave as a pre-launch snapshot. Cheap either way; record the choice rather than letting it bit-rot silently.

---

## IP-sensitive content → DB-backed Settings (added 2026-05-11)

**Trigger:** Repo flipping to public on 2026-05-11 to unlock free GitHub rulesets (branch protection). Anything sensitive must move out of source.

**What's IP-sensitive in the repo today:**
- `lib/diagnostic/prompts.ts` — Claude system prompt + user-prompt template. Practitioner voice, forbidden words, tone-by-tier matrix. Core IP for the report quality.
- `lib/diagnostic/content.ts` — `QUESTIONS` array (19 questions with hand-tuned option labels + descriptions), per-option scores with calibration deviations, `RISK_FLAG_RULES`, `PRIORITY_TRIGGERS`, `TIER_BOUNDARIES`, `DOMAIN_WEIGHTS`. Hand-calibrated through persona testing — replicable but expensive to recreate.
- `wiki/concepts/diagnostic-scoring-logic.md` — full scoring matrix in plain English. Explains the IP above more clearly than the code does.
- `wiki/decisions/2026-05-09-diagnostic-scoring-calls.md` — the calibration rationale.

**Per `feedback_config_tier_hierarchy.md` memory:** anything that may change in future = DB-backed Settings. Prompts will change as we learn what reports work; questions and scoring values will be retuned. Both belong in Settings, not source.

**Sequenced backlog:**

26. **Move Claude system prompt to Settings** — ✅ shipped 2026-05-12 (PR #9). Source has a generic fallback; real prompt lives in `site_setting` key `'diagnostic_prompt'`, edited via `/admin/prompts`. Stamped onto each `report_output.prompt_version`.

27. **Move diagnostic content to DB** — ✅ shipped 2026-05-12 (PR #12). Source has a placeholder fallback; real content lives in `site_setting` key `'diagnostic_content'`, edited via `/admin/diagnostic`. `getDiagnosticContent()` per-request loader; scoring engine refactored to take content as a parameter. `pnpm extract-content` recovers historical content from git history for seeding.

28. **Relocate sensitive wiki to a private location** — ✅ shipped 2026-05-13. Chose Option A (rewrite as overview). Both `wiki/concepts/diagnostic-scoring-logic.md` and `wiki/decisions/2026-05-09-diagnostic-scoring-calls.md` are now architecture/discipline overviews; specific values + persona test results redacted out of public docs. Full original content recoverable from git history before this date via `pnpm extract-content <commit>`.

**Priority:** After W4 Pass 2 (magic-link, revenue path) but before any third-party (contractors, partners) gets repo access beyond the current second dev. Treat as Phase 2.5 hardening. Items 26 and 27 can be split — prompt move is smaller and higher value (it's actively tuned); content move is larger.

---

## Phase 1.E — Book a Call (replaces mailto: CTAs) — ✅ SHIPPED 2026-05-17 (items 29–30)

**Status:** Lane A foundations (PR #8, #10), Lane B Calendar + Claude (PRs #41, #42, #44, #45, #46, #48), Lane C slot math + scheduler (PRs #39, #40, #44) all shipped. Live at `/book/[slug]`. See [[shipped]] for the index entry, [[state]] for live routes, and [[book-a-call-architecture]] for the architecture overview. Follow-up items 31–34 all shipped 2026-06-12.

Per the CEO + design + eng plan review locked 2026-05-12, the home page's `mailto:` CTAs are being replaced with a self-serve calendar booking flow that creates Google Meet invites and feeds an AI-augmented pre-call pipeline (AI follow-up question on the intake, AI pre-call brief to Rob 1h before, AI-matched blog posts in the confirmation email, scheduled reminders + no-show recovery). Lane A foundations (schema for 5 new tables, AES-GCM crypto, JWT magic links, error hierarchy, redaction, 10 UI primitives, 6 email templates) shipped in PR #8 + PR #10. Full plan + design spec + eng review at `~/.claude/plans/before-we-start-can-indexed-riddle.md` (external; not in repo).

29. **Lane B — Google Calendar + Claude integrations** — ✅ shipped 2026-05-17 across PRs #41 (OAuth flow + Calendar API client), #42 (booking page + create flow including the conversational intake follow-up), #44 (cron processor wires pre-call brief), #45 (booking prompts → DB), #46 (eval suite), #48 (JSON-recovery parser hardening). See [[book-a-call-architecture]] + [[booking-prompts-in-db]] + [[claude-eval-suites]].

30. **Lane C — Calendar slot math + scheduler** — ✅ shipped 2026-05-17 across PRs #39 (`lib/calendar.ts` with DST + 23 unit tests) + #40 (`lib/scheduler.ts` with FOR UPDATE SKIP LOCKED + 15 unit tests) + #44 (cron processor that drains the queue). See [[book-a-call-architecture]].

## Phase 1.E follow-ups — ✅ SHIPPED 2026-06-12 (items 31–34)

31. **Admin: mark booking as `no_show` / `completed`** — ✅ shipped 2026-06-12. New `/admin/bookings` page with table, status filter, search, pagination. `PATCH /api/admin/bookings/[id]/status` flips status. "Bookings" tab in admin sidebar.

32. **Consultant profile UI** — ✅ shipped 2026-06-12. `GET/PATCH /api/admin/consultant/profile`. Form added below OAuth controls on `/admin/integrations/google-calendar` — edits displayName, slug, timezone, slotMinutes, slotBufferMinutes, advanceDays, minNoticeHours, workingHoursJson, publicEmail.

33. **Blog library + matching wiring** — ✅ shipped 2026-06-12. `lib/blog-library.ts` + `lib/blog-library-shared.ts` getter from `site_setting` key `'blog_library'`. `matchBlogPosts()` wired into booking create route. Admin editor on `/admin/prompts/blog-matching`. `GET/PUT /api/admin/settings/blog-library`.

34. **Cron alert on terminal failure** — ✅ shipped 2026-06-12. `buildCronFailureAlertEmail()` in `lib/booking-emails.ts`. Wired into cron processor — fires `[ALERT]` email to consultant when `decideRetryStatus` returns `'failed'`.

---

## Phase 3 — Translation Layer follow-ups (added 2026-05-20)

**Status:** Phase A (schema), Phase B (public render), Phase C (cutover ops scaffold) all shipped — PRs #61 → #68. The Translation Layer is live at `archoslabs.xyz/blog`. Items below are the deliberate-deferrals from those phases plus operational ops that need scheduling. Decision context: [[2026-05-19-translation-layer-migration]] (architecture + plan), [[2026-05-20-translation-layer-public-render]] (Phase B), [[2026-05-20-phase-c-cutover]] (Phase C post-mortem + remaining ops).

### Phase D — feature work (each gets its own PR when prioritised)

35. **Newsletter capture + Resend integration (D1)** — signup card at the 60% scroll mark on `/blog/[slug]` + footer variant, `/api/newsletter/subscribe` + `/api/newsletter/confirm`, double-opt-in flow via Resend, rate-limit 5/min/IP, idempotent for already-subscribed addresses, admin list at `/admin/newsletter`. `newsletter_signup` schema already shipped in PR #61. Verify: real signup arrives in inbox; confirmation link consume idempotent; admin list paginates.

36. **`/search` page + Cmd-K modal (D2)** — semantic search over the 1024-dim post embeddings via HNSW ANN, FTS fallback on provider failure. `/search?q=...` shareable URL surface + `Cmd-K` / `Ctrl-K` modal that reuses the same result component. Mobile: slide-up sheet. Empty-state fallback: "No matches for '[query]'. Try [3 popular categories as chips]." Verify: typing returns debounced ranked results in <200ms p99; Cmd-K opens from any page; keyboard nav works.

37. **Admin `needs_review` queue UI** — ✅ **SHIPPED 2026-05-20** (Slice A backend PR #72, Slice B UI in feature/posts-admin-ui). Filter pill on `/admin/blog/posts` surfaces the 120-post queue; per-post "Mark reviewed" button in the editor side panel flips `needs_review=false` and writes an audit revision. See [[2026-05-20-posts-admin-phase-d-backend]] + [[2026-05-20-posts-admin-phase-d-ui]].

38. **Per-post admin editor** — ✅ **SHIPPED 2026-05-20** (Slice A backend PR #72, Slice B UI in feature/posts-admin-ui). `/admin/blog/posts/*` — list view, create, edit, revisions, soft-delete + restore, scheduled publishing with `WHERE status='scheduled'` race-guarded cron, AI-assist buttons (regenerate OG, suggest internal links via existing embeddings), split-pane live preview, optimistic-lock conflict banner. See [[2026-05-20-posts-admin-phase-d-ui]] for the UI architecture + the locked decisions on preview parity, side-effect surfacing, and schedule validation.

### Phase D — explicit deferrals beyond Slice B (added 2026-05-20)

These came up in the Slice A planning but were deliberately excluded from the cathedral so the surface ships at all. Each is a discrete v2 candidate:

- **Featured-image upload UI** to override `post.ogImagePath` manually (currently the OG image is auto-generated only).
- **AI-generate-excerpt button** in the editor — would call Claude per click, costs $ per use, easy to add once Slice B is in and we know the editor ergonomics.
- **Draft auto-archive (>90 days)** to keep the list view clean as drafts accumulate.
- **RSS/sitemap auto-regen on publish** — currently sitemap is rebuilt on every `/blog` request; RSS doesn't exist yet (item 39 below).
- **Multi-author UX** — `post.authorId` exists but only one admin today; multi-author needs author management UI + per-user auth.
- **Inline image upload in editor** — separate R2 endpoint work; the AI-assist "Suggest internal links" feature partially mitigates by helping the author cross-link existing posts.
- **Internal-link auto-insertion** — suggestions are manual-insert only in Slice B; smart auto-insertion is hard UX to get right and warrants its own iteration.
- **Post-performance analytics dashboard** — view counts, scroll depth, engagement — depends on item 41 (Plausible) being live first.
- **Comments / discussion** — not a planned surface for this brand.
- **A/B title testing** — premature for current readership scale.
- **LinkedIn auto-cross-post on publish** — Modelling Room ≠ Translation Layer per [[translation-layer]]; these are deliberately separate channels.

### Phase D — discovered during image metadata work (added 2026-05-21)

- **Import 3 WP `future` posts as scheduled drafts.** WP DB `uhiz_posts` has 3 rows with `post_status='future'` (scheduled publish dates in WP that haven't fired yet) that were NOT migrated on 2026-05-20 because the migration script filtered to `post_status='publish'` only. Now that we have `post.status='scheduled'` + `scheduled_publish_at` (migration 0014) + the publisher cron live, these 3 are natural candidates to import as `scheduled` rows so our cron takes over WP's publishing job. Small script — `pnpm tsx scripts/import-wp-future.mjs` — extends `scripts/migrate-wp/extract.ts` to pull `future` rows + INSERT with mapped status. Verify: count goes from 253 → 256 in `post` table; cron flips them on their scheduled date.

- **Manual alt-text review pass for the 155 WP-sourced rows.** The 2026-05-21 backfill (scripts/backfill-og-image-alt.mjs) populated `post.og_image_alt` from `wp_postmeta._wp_attachment_image_alt` for 155 posts. The remaining 98 fell back to post title. The WP-sourced alt is often image-description style (e.g. "Illustration of a modern AI model jamming an old conveyor belt") — useful for screen readers but not always SEO-optimised. Triage prioritised by traffic: pull top-20 pageviews from Plausible (item 41) once analytics is live, hand-edit those alts first via `/admin/blog/posts/[id]` editor, then work down the long tail. Verify: spot-check 5 high-traffic posts on a screen reader (VoiceOver / NVDA) — alt should read naturally as a 1-2 sentence image description.

- **Review truncated alt text rows (125-char cap mid-sentence cuts).** The backfill hard-truncates at 125 chars per CHECK constraint design — some WP alts were longer and got cut mid-thought. First known candidate: `ai-infrastructure-strategy` (alt currently ends with "...symbolizing AI strategy built"). Query: `SELECT slug, og_image_alt FROM post WHERE length(og_image_alt) = 125 ORDER BY slug;` to find all truncations. Either edit each manually in the admin editor or relax the cap (CHECK constraint can be dropped + a higher limit re-applied — needs migration 0018 or similar).

39. **RSS `/blog/feed.xml` route** — for readers who follow via RSS reader + LinkedIn newsletter sync. Last 20 listed posts, full excerpt + link back. Verify: validates at validator.w3.org/feed; LinkedIn newsletter import succeeds.

### Phase 3 polish (smaller items)

40. **Admin "Embeddings Model ID" field in `/admin/integrations`** — currently `OPENROUTER_EMBED_MODEL` is env-only override; promised as an admin-managed setting so the model can be swapped without a redeploy (e.g. when OpenAI ships a successor to `text-embedding-3-large`). Same encryption-at-rest + audit-log treatment as the other integration secrets. Verify: change in admin → next embedding generation uses the new model id without restart.

41. **Plausible analytics integration (E7 deferred)** — privacy-respecting analytics for the conversion funnels: `/` → `/blog`, `/blog/[slug]` → `/book/[slug]`, `/tools/ai-readiness` → registration → call. ~$9/mo. Lightweight script tag in layout, custom events for the booking + newsletter signup paths. **Deferred per the plan's E7 deferral** — was below the cut line for the launch but should land before any backlink-outreach campaign so we can measure citations + referral conversion. Verify: events fire on staging; dashboard shows funnel data within 24h.

### Phase 3 operational ops (your move, no code)

42. **Submit `https://archoslabs.xyz/sitemap.xml` to Google Search Console** — archoslabs.xyz property → Sitemaps → submit URL. Verify: GSC reports all 257 /blog-prefixed URLs discovered within 7 days.

43. **Submit same URL to Bing Webmaster Tools** — archoslabs.xyz property → Sitemaps → submit. Bing → Copilot → ChatGPT pipeline means Bing indexing is indirect AIEO surface. Verify: Bing dashboard reports sitemap processed.

44. **Apex 301 from `robertangeles.com/*` → `https://archoslabs.xyz/blog`** — in the domain registrar's forwarding settings. Pick **Permanent (301)**, not 302. Single-line forward, no per-slug redirect map needed. Verify: `curl -sI https://robertangeles.com/some-old-path` returns HTTP 301 + correct Location header.

45. **Calendar reminders for `robertangeles.com` non-renewal** — T+30 days post-step-44, review redirect traffic. T+60 days, schedule the domain for non-renewal and decommission the WP install (keep one offline SQL dump as an archive — never published anywhere). Verify: reminder exists in calendar; both checkpoints have an owner.

### Phase 3 SEO follow-ups (code work)

48. **IndexNow push-indexing client — ✅ SHIPPED 2026-05-21.** `lib/indexnow.ts` + `app/indexnow.txt/route.ts` + write-path wiring across posts admin, pages admin, and scheduled-publisher cron. Submits to `api.indexnow.org` (Bing/Yandex/Naver/Seznam/Yep/Amazon); Google doesn't participate. Fire-and-forget with 5-min same-URL debounce. See [[2026-05-21-indexnow]] for the full record. Operator step: set `INDEXNOW_KEY` in Render env.

47. **Per-slug 301 redirect mechanism** — the WP migration produced one malformed slug (`ai-workforce-strategy-without-people-plansai-workforce-strategy-without-people-plans`, fixed in DB 2026-05-21). The old URL had been in the live sitemap before the fix, so external indexers may have it cached. There is currently NO in-codebase redirect mechanism — no `middleware.ts`, no `next.config.ts` `redirects()` block, no `lib/redirects/`. Two acceptable shapes:
    - **Static `redirects()` in `next.config.ts`** — fine for the one entry today, simplest possible thing.
    - **DB-backed `redirect` table read by middleware** — right shape if/when more slug renames happen (e.g. operator-driven slug edits in the admin). Schema: `from_path text PK, to_path text NOT NULL, status int default 301, created_at timestamptz`. Middleware reads cache, falls through to the route handler.
    Verify: `curl -sI https://archoslabs.xyz/blog/ai-workforce-strategy-without-people-plansai-workforce-strategy-without-people-plans` returns `301` + correct `Location` header. Pick whichever shape fits the size of the problem when it lands (start static; promote to DB-backed only when the second rename happens).

### Phase 3 content sweep (only Rob can do)

46. **Review the 120 `needs_review` posts** — Claude flagged 120 of the 253 migrated posts during the polish step. Two distinct buckets in the manifest:
    - **Currency flags** — dated 2024/2025 citations whose enforcement dates / forecast windows have now elapsed (EU AI Act phases, Gartner forecasts, etc.). Worth re-stating or re-anchoring.
    - **Template artefacts** — un-resolved `[PERSON_NAME]` and `[ADDRESS]` placeholders in the original WordPress source content (pre-existing content debt, not migration damage).
    Verify: every post in the queue is either edited + `needs_review` cleared, or marked `unlisted` if the content debt is unfixable. Best done in batches alongside item 37 once the admin queue UI exists.

---

## Phase 4 — Social Accounts follow-ups (added 2026-06-12)

**Status:** Social Accounts v1 (connect + publish) shipped in PR #151. Twitter/X, LinkedIn, and Bluesky OAuth/auth flows live. Publish dispatcher with rate limiting + dedup live. Social Accounts tab, publish modal with per-platform editing + char counters, admin integrations panel all shipped. Items below are deferred from the CEO review cherry-pick ceremony and eng review.

49. **Content calendar with scheduled publishing** — Users can publish immediately but cannot schedule posts for future times (e.g. "post this Tuesday at 9am"). Requires: `scheduled_post` table (or extend `publish_log` with `scheduled_at` + `status=pending`), background cron job to fire scheduled posts, calendar UI in the workspace. Depends on: social accounts v1 (shipped). Effort: L (human ~1 week / CC ~4 hours). Verify: user schedules a post for 5 minutes from now; cron fires it; publish_log shows success.

50. **Social analytics / engagement tracking** — Track post performance after publishing (impressions, likes, reposts). Requires: platform read API access (Twitter Analytics API, LinkedIn Statistics API), `publish_analytics` table, dashboard UI. Depends on: social accounts v1 (shipped) + Plausible (item 41). Effort: L (human ~1 week / CC ~4 hours). Verify: dashboard shows engagement metrics for a published post within 24 hours.

51. **Per-platform feature flags (cache fix)** — ✅ **SHIPPED 2026-06-12.** Root cause was not stale cache but the PATCH schema's Zod union missing `z.boolean()` — toggle values silently 400'd, so the DB was never written. Cache invalidation was already wired via `updateIntegrationSecret` → `clearIntegrationConfigCache()`. Fix: added `z.boolean()` to PatchSchema value union. Commit `351e958`.

---

## What's deliberately not on this list

- Admin panel — deferred per [[2026-05-08-admin-deferred]] until Phase 2 ships and there's content to manage.
- Internationalisation — single-language launch.
- Custom CMS — content lives in code or markdown until volume demands otherwise.
- Multiple tools — only the AI Readiness Assessment is in scope at Phase 2. The platform is structured for more, not built for more.
- Multi-Claude-call architecture — the spec's three concurrent calls collapsed to one structured-JSON call (cost, latency, coherence).
- Sector benchmark bars — fake numeric data on a credibility-driven tool. Replace with verdict statement only at MVP. Earn back when there are 100+ real submissions to derive actual benchmarks.
- Supabase — replaced with Render Postgres + Drizzle + Resend magic-link per CLAUDE.md standards (see [[2026-05-08-render-postgres-over-neon]] for the later Neon → Render Postgres swap).
- Separate staging environment — single-DB posture per [[deployment-architecture]]; revisit only when a second contributor lands or a destructive schema change warrants rehearsal.
- TTS / audio versions of posts — bling without demand signal; revisit when post analytics suggest audio-first readers exist.
- "Mentioned in" cross-post backlinks — useful for a 200-post library but cosmetic until the search + admin queue are in.

---



- Admin panel — deferred per [[2026-05-08-admin-deferred]] until Phase 2 ships and there's content to manage.
- Internationalisation — single-language launch.
- Custom CMS — content lives in code or markdown until volume demands otherwise.
- Multiple tools — only the AI Readiness Assessment is in scope at Phase 2. The platform is structured for more, not built for more.
- Multi-Claude-call architecture — the spec's three concurrent calls collapsed to one structured-JSON call (cost, latency, coherence).
- Sector benchmark bars — fake numeric data on a credibility-driven tool. Replace with verdict statement only at MVP. Earn back when there are 100+ real submissions to derive actual benchmarks.
- Supabase — replaced with Render Postgres + Drizzle + Resend magic-link per CLAUDE.md standards (see [[2026-05-08-render-postgres-over-neon]] for the later Neon → Render Postgres swap).

---

## First build priority

**Phase 0 items 1–4 in order:** Brand foundation → Layout shell → Home page → Render deploy + custom domain.

This is the critical path to a sendable URL — the artifact Rob needs in a consultant's hands within 11 days. CI, tests, and pre-commit hooks (items 5–7) come immediately after, hardening the live site rather than gating its first deploy. Wiki scripts (item 8) are parallelisable any time.
