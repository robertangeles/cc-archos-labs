---
title: Shipped Backlog Items
category: synthesis
created: 2026-05-17
updated: 2026-06-14
related: [[backlog]], [[state]], [[2026-05-08-phase2-ceo-review]], [[book-a-call-architecture]], [[2026-05-17-home-page-pas-rewrite]], [[home-page-section-components]], [[translation-layer]], [[deployment-architecture]]
---

Historical record of items moved out of [[backlog]] once shipped. For current ship state by route / endpoint / component, see [[state]] (auto-generated, always fresh). [[backlog]] going forward describes **intent only**.

## Phase 0 — Foundation (shipped 2026-05-07 onwards)
- Item 1 — Brand foundation (typography scale, colour tokens, spacing via Tailwind v4 `@theme`). See [[2026-05-07-linear-redesign]].
- Item 2 — Layout shell (`components/layout/{header,footer,nav}.tsx`). See [[2026-05-07-layout-shell]].
- Item 3 — Home page (`/`) with consulting CTA. See [[2026-05-07-home-page]]. **Note:** superseded by the May 2026 PAS rewrite (separate PR).
- Item 4 — Render deploy + custom domain. `https://archoslabs.xyz` live.
- Items 5–7 — CI pipeline, Vitest, Husky + lint-staged. Confirm via `package.json` devDependencies + `.husky/` files.
- Item 8 — Wiki tooling scripts (`wiki-search.mjs`, `wiki-graph.mjs`, `wiki-state.mjs`, `wiki-ingest.mjs`, `wiki-lint.mjs`).

## Phase 1 — Revenue Now (shipped 2026-05-15 – 2026-05-27)
- Item 9 — Consulting page (`/consulting`). Shipped 2026-05-27. SMB rewrite with "I" voice, ServiceCard components, Objection FAQ, StickyMobileCta.
- Item 10 — Contact endpoint (`POST /api/contact`). Shipped 2026-05-15.
- Item 11 — Contact form UI. Shipped 2026-05-22. Embedded on Home + Consulting + `/contact` page.
- Item 12 — Basic SEO + meta. Shipped. OG image generators (`app/opengraph-image.tsx`, per-page variants), `sitemap.xml` route, meta tags on all pages.
- Item 13 — Privacy + terms pages. Shipped. DB-managed pages via `app/[...slug]` catch-all + CMS pages admin. Footer linked.

## Phase 1.E — Book a Call (shipped 2026-05-17)
- Item 29 — Lane B: Google Calendar OAuth + Calendar API + booking page + Claude pre-call brief + Resend confirmations + AI follow-up question on intake. PRs #41, #42, #44, #45, #46, #48. See [[book-a-call-architecture]] and [[booking-prompts-in-db]].
- Item 30 — Lane C: Calendar slot math + scheduler with FOR UPDATE SKIP LOCKED + cron-driven queue drain. PRs #39, #40, #44. See [[book-a-call-architecture]].

## Phase 1.E follow-ups (shipped 2026-06-12)
- Item 31 — Admin bookings page (`/admin/bookings`) with table, status filter, search, pagination. `PATCH /api/admin/bookings/[id]/status`.
- Item 32 — Consultant profile UI. `GET/PATCH /api/admin/consultant/profile`. Form on `/admin/integrations/google-calendar`.
- Item 33 — Blog library + matching wiring. `lib/blog-library.ts`. Admin editor at `/admin/prompts/blog-matching`. `matchBlogPosts()` wired into booking create route.
- Item 34 — Cron alert on terminal failure. `buildCronFailureAlertEmail()` fires `[ALERT]` email when `decideRetryStatus` returns `'failed'`.

## Phase 2 — AI Readiness Assessment (shipped 2026-05-13)
Items 14–25 inclusive. Full route set at `/tools/ai-readiness` (welcome → questions → registration gate → report → PDF → share tokens → return-visitor portal), backed by `/api/diagnostic/*` endpoints, magic-link auth via `/api/auth/lead/*`, and admin diagnostic settings at `/admin/(authed)/diagnostic`. See [[2026-05-08-phase2-ceo-review]] for the CEO review and [[state]] for the live route list.

## Phase 2.5 — IP-sensitive content moved to DB (shipped 2026-05-12 / 2026-05-13)
- Item 26 — Claude system prompt moved to Settings (PR #9). Source has generic fallback; real prompt lives in `site_setting` key `'diagnostic_prompt'`, edited via `/admin/prompts`.
- Item 27 — Diagnostic content moved to DB (PR #12). Source has placeholder fallback; real content lives in `site_setting` key `'diagnostic_content'`, edited via `/admin/diagnostic`. `pnpm extract-content` recovers historical content from git history.
- Item 28 — Sensitive wiki relocated. Architecture overviews only; specific values redacted from public docs.

## Home page PAS rewrite (shipped 2026-05-18, PR #53)
Replaced the May 7 four-section home page with a 9-section PAS sales page. Dual CTA (Take the assessment + Book a call). See [[2026-05-17-home-page-pas-rewrite]] and [[home-page-section-components]].

## About page (shipped 2026-05-27)
`/about` with PersonCard, PhilosophyBlock, WayOfWorkingSteps components. OG image variant.

## Phase 3 — Translation Layer (shipped 2026-05-19 – 2026-05-21)
- Blog surface at `/blog` with 253 migrated posts, AIEO chrome, category pages, admin toggle.
- Items 37–38 — Posts admin editor + `needs_review` queue UI. Shipped 2026-05-20 (PRs #72 + feature/posts-admin-ui).
- Item 39 — RSS feed at `/blog/feed.xml`. Shipped.
- Item 47 — Per-slug 301 redirect mechanism. Shipped 2026-06-12. Static `redirects()` in `next.config.ts`.
- Item 48 — IndexNow push-indexing client. Shipped 2026-05-21. `lib/indexnow.ts` + write-path wiring.
- Items 42–43 — Sitemap submitted to GSC + Bing Webmaster. Shipped 2026-06-12 (manual by Rob).

## Phase 4 — Social Accounts (shipped 2026-06-12 – 2026-06-14)
- Social Accounts v1 — Twitter/X, LinkedIn, Bluesky OAuth/auth flows. Publish dispatcher with rate limiting + dedup. Admin integrations panel. PR #151.
- Item 49 — Content calendar with scheduled publishing. Shipped 2026-06-14. `scheduled_social_post` table, cron publisher, CRUD endpoints, publish modal with schedule toggle, scheduled posts list page.
- Item 51 — Per-platform feature flags fix. Shipped 2026-06-12. Commit `351e958`.

## CMS Pages system (shipped, date varies)
Full DB-backed page management: `page`, `pageBlock`, `pageRevision` tables. Admin CRUD at `/admin/(authed)/pages` with blocks editor, revisions, soft-delete + restore. Public render via `app/[...slug]` catch-all. Privacy, terms, and other content pages served from DB.

## User auth system (shipped, date varies)
Multi-strategy auth: magic links (Resend), Google OAuth, email/password with password reset. Email change with confirmation. Session-based auth. Routes at `/api/auth/*`, UI at `/(auth)/*`.

## Admin panel (shipped, date varies)
Full admin at `/admin/(authed)/*`: users, site settings, integrations (AES-GCM encryption, audit log, master key rotation, provider tests), knowledge base, blog posts, pages, bookings, prompts, CDMP config, auth settings.

## Chat workspace (shipped 2026-06-08–10)
Conversational AI: `conversation`, `message`, `conversationShare` tables. CRUD + search at `/api/chat/*`. Image support, slash commands, share via token. History at `/account/history`.

## Skill execution platform (shipped 2026-06-07–08)
User-defined skills with versioning: `skill`, `skillVersion`, `skillInput`, `skillOutput`, `skillExecution` tables. CRUD + execute at `/api/skills/*`. UI at `/account/skills/*`.

## Workflow builder (shipped 2026-06-07–08)
Multi-step workflow automation: `workflow` + 6 supporting tables. CRUD + execute + streaming at `/api/workflows/*`. UI at `/account/workflows/*`. Duplicate support.

## Rules engine (shipped, date varies)
User-defined automation rules: `userRule` table. CRUD + toggle at `/api/rules/*`.

## Brain / memory system (shipped 2026-06-10)
Per-user brain provisioning: `userBrain` table. Status + provision + memories at `/api/brain/*`. UI at `/account/brain`.

## Account workspace (shipped 2026-06-11)
Unified workspace at `/account/workspace`. Sub-pages: brain, history, personalisation, scheduled posts, social accounts, skills, workflows.

## CDMP Practice Exam (shipped 2026-06-03)
Free CDMP practice exams at `/tools/cdmp-practice`. `cdmpExamSession`, `cdmpExamAnswer`, `cdmpQuestionFlag` tables. History, results, flagging. API at `/api/cdmp/*`. Admin config at `/admin/(authed)/cdmp`.

## Knowledge base (shipped, date varies)
Document upload + chunking: `knowledgeDocument`, `knowledgeChunk` tables. Admin UI at `/admin/(authed)/knowledge`.

## llms.txt (shipped, date varies)
LLM-friendly site description at `/llms.txt` and `/llms-full.txt`.

---

## What still belongs in [[backlog]]

Items still describing intent (not ship state):
- Item 35 — Newsletter capture + Resend integration
- Item 36 — `/search` page + Cmd-K modal
- Item 40 — Admin "Embeddings Model ID" field
- Item 41 — Plausible analytics integration
- Item 44 — Apex 301 from `robertangeles.com`
- Item 45 — Calendar reminders for domain non-renewal
- Item 46 — Review 120 `needs_review` posts (Rob-only content sweep)
- Item 50 — Social analytics / engagement tracking
- Phase D explicit deferrals (featured-image upload, AI-generate-excerpt, draft auto-archive, multi-author UX, inline image upload, etc.)
- Housekeeping: tense update on Translation Layer decision doc, manual alt-text review, truncated alt-text rows, import 3 WP `future` posts
