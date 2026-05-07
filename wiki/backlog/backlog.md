---
title: Archos Labs HQ — Build Backlog
category: synthesis
created: 2026-05-07
updated: 2026-05-07
related: [[index]], [[log]]
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

## Phase 2 — Lead Gen (Executive AI Diagnostic)

The medium-term tool-led pipeline. Higher complexity, deferred until Phase 1 is converting.

14. **Diagnostic content design** — questions, clusters, scoring rubric, tier definitions. Authored as data (not code), reviewable independently of the build. Verify: content sign-off from Rob before any code is written.
15. **Diagnostic UI (`/tools/executive-ai-diagnostic`)** — multi-step form, progress indicator, free-text "context" field per question. Mobile-first, instant feedback, no page reloads. Verify: full flow completable on mobile in under 5 minutes.
16. **Diagnostic scoring (`lib/diagnostic.ts`)** — pure scoring logic, no LLM call. Unit tested. Returns tier + score + cluster breakdown. Verify: unit tests cover each tier boundary and edge case (all-A, all-D, mixed).
17. **LLM client (`lib/model.ts`)** — OpenRouter via the Anthropic-compatible interface (per CLAUDE.md tech stack), API key in env var, error handling, no client-side calls. Verify: a live API call in dev returns a structured response; key never appears in any client bundle.
18. **Report generation (`POST /api/diagnostic`)** — wires UI → scoring → LLM → structured report (snapshot, risks, recommendations, urgency). Rate-limited, never logs answers, returns plain-language errors. Verify: integration test with a fixture answer set returns the documented response shape; pen-test for prompt injection on the free-text fields.
19. **Diagnostic results page** — formatted report. Specific, not generic. Worth sharing. CTA to book a paid follow-up call. Verify: one real report end-to-end, reviewed by Rob, judged "specific enough to share unprompted".
20. **Lead capture on completion** — diagnostic results gated by email entry (or shown then offered to email). Stores lead with consent. Verify: lead lands in destination (email/DB), GDPR-aware consent text in place.

**Phase 2 ships when:** a cold visitor can complete the diagnostic, receive a specific report, and convert to a paid call request without a human in the loop.

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

## What's deliberately not on this list

- Auth — no logged-in users in scope yet.
- Admin panel — no need until there is content/config to manage.
- Internationalisation — single-language launch.
- Custom CMS — content lives in code or markdown until volume demands otherwise.
- Multiple tools — only the Executive AI Diagnostic is in scope. The platform is structured for more, not built for more.

---

## First build priority

**Phase 0 items 1–4 in order:** Brand foundation → Layout shell → Home page → Render deploy + custom domain.

This is the critical path to a sendable URL — the artifact Rob needs in a consultant's hands within 11 days. CI, tests, and pre-commit hooks (items 5–7) come immediately after, hardening the live site rather than gating its first deploy. Wiki scripts (item 8) are parallelisable any time.
