---
title: Archos Labs HQ — Build Backlog
category: synthesis
created: 2026-05-07
updated: 2026-05-11
related: [[index]], [[log]], [[2026-05-08-phase2-ceo-review]]
---

Prioritised build list for the Archos Labs HQ at archoslabs.xyz. Ordered by what unblocks revenue and reduces risk, not by what is most fun to build.

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

## Phase 2 — Lead Gen (AI Readiness Assessment)

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

21. **Modelling Room page (`/modelling-room`)** — initially just a styled link out to the LinkedIn newsletter. Verify: page exists, link tracked.
22. **Tools index (`/tools`)** — Executive AI Diagnostic listed; placeholder for future tools. Verify: page exists, structured for additions.
23. **Analytics** — privacy-respecting (Plausible or similar). Track conversion funnel: visit → contact submit, visit → diagnostic complete, diagnostic complete → call booked. Verify: events fire on staging.
24. **Newsletter signup** — separate from contact form. Verify: integration test + real signup lands in destination.

---

## Cross-cutting (every phase)

- **Security review** before merging any feature touching user input or external APIs (CLAUDE.md OWASP categories).
- **Wiki updates** before any feature is marked complete (CLAUDE.md `wiki/` mandate).
- **Lessons learned** entries for any non-obvious bug fix or architectural decision.
- **No DB** until a feature genuinely requires persistence — defer until lead capture or diagnostic submissions need it. When added, follow CLAUDE.md Database Design Standards (2NF, indexed FKs, naming conventions).

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

26. **Move Claude system prompt to Settings** — extend `site_setting` (or new `prompt_template` table — decide at design) so `lib/diagnostic/prompts.ts` reads from DB at request time. Versioned via `prompt_version` already stored on `report_output`. Add Content & Copy admin tab to edit it. Verify: edit in admin → next report generation uses new prompt → `prompt_version` increments → old reports still resolve via stored version metadata.

27. **Move diagnostic content to DB** — questions, options, per-option scores, branch rules, risk flag rules, priority triggers, tier boundaries, domain weights. Probably needs new tables (`diagnostic_question`, `diagnostic_option`, etc.) because the shape is richer than a single JSONB blob. Edits surface in the admin Content & Copy tab. Verify: edit a question text in admin → assessment page reflects on next request → scoring still passes the existing persona tests (smoke regression: run `scripts/test-diagnostic.ts` against DB-loaded content).

28. **Relocate sensitive wiki to a private location** — `wiki/concepts/diagnostic-scoring-logic.md` and `wiki/decisions/2026-05-09-diagnostic-scoring-calls.md` either move to a `private-notes/` directory that's gitignored and synced via personal channel, OR get rewritten as high-level overviews with the calibrated values redacted. Decide which when 26/27 land.

**Priority:** After W4 Pass 2 (magic-link, revenue path) but before any third-party (contractors, partners) gets repo access beyond the current second dev. Treat as Phase 2.5 hardening. Items 26 and 27 can be split — prompt move is smaller and higher value (it's actively tuned); content move is larger.

---

## What's deliberately not on this list

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
