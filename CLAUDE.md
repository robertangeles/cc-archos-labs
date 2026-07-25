# CLAUDE.md

## 0. Read Before You Write
Before writing, read every file you will touch. Copy existing patterns and check imports to see what the project actually uses. Ask when you cannot find a pattern.

## 1. Think Before Coding
State assumptions explicitly. Name tradeoffs. If multiple interpretations exist, present them — do not pick silently. Stop and ask when genuinely confused. Role play as Nobel Laureate solving this problem.

## 2. Simplicity
Minimum code for the problem now. No speculative features, abstractions, or impossible-case error handling. Hardcode values until there is a real reason to configure. Test: if abstracted only "in case we need to" — over-built.

## 3. Surgical Changes
Touch only what the task requires. Match existing style. No reformatting. Every changed line must trace to the request. "While I was in there" → revert.

## 4. Goal-Driven Execution
Define success criteria before coding. For multi-step tasks, state the plan first.
`"Add validation"` → `"reject malformed email, return 400, test both cases"`

## 5. Dependencies
Every dependency is permanent code you do not control. Check stdlib first. State why when adding one.

## 6. Communication
Say what you did and why. Flag concerns even when you did exactly what was asked. Precise uncertainty: "I am not sure this library supports streaming" not "I think this should work."

## 7. Common Failure Modes
- **Kitchen Sink** — restructuring unrelated code
- **Wrong Abstraction** — generalising after two copy-pastes
- **Optimistic Path** — 500 unhandled
- **Runaway Refactor** — fix cascades across files

Stop when you catch any of these.

---

## Workflow

**Plan Mode** — any task with 3+ steps or architectural decisions. Re-plan immediately if anything goes sideways.

**Subagents** — spawn liberally, one task each. Mandatory standup before execution to align every agent. Tell every Explore subagent to verify backlog status against `wiki/state.md` before reporting a feature as unbuilt.

**Verification** — never mark done without proof. Ask: "Would a staff engineer approve this?" Update `wiki/` before closing any user-facing task.

**Demand Elegance** — ask "What would a top 0.1% person in this field think?" If hacky, refactor before presenting.

**Autonomous Bug Fixing** — investigate logs and resolve without requiring user guidance. Fix failing tests and CI independently. Always follow Debugging Protocol.

---

## Testing

Write the failing test first. Watch it fail. Then fix. Test behavior that can break, not that a constructor sets a field. Hard to test = information about the design.

New features require: unit, integration, E2E, penetration, Playwright UI tests.

Every new service function needs a unit test. Every new API endpoint needs an integration test and penetration test. Every user-facing feature needs at least one E2E test and a Playwright test. Test the unhappy path: invalid input, missing auth, rate limits, edge cases.

**Regression protocol before closing any task:**
1. `pnpm test`
2. `pnpm test:integration`
3. `pnpm tsc`
4. Schema changed → `drizzle-kit push`
5. Verify every touched route: 200 happy path, 401 no auth, 400/404 bad params — frontend wired only after backend verified
6. Report pass/fail before closing

---

## Debugging Protocol (MANDATORY)

1. Read error exactly as written. Do not interpret.
2. Identify exact file, line, function.
3. Label anything beyond the error as [Inference].
4. No fix until root cause confirmed by evidence.
5. Unknown root cause → "I need more information" + list what.
6. One problem. One fix. One test. Change one thing at a time.
7. Never paper over a null. Find why it is null.

Format every response:
- Confirmed: [what error proves]
- Evidence: [file, line, log]
- Root cause: [if confirmed]
- Fix: [after root cause only]
- Verify with: [command or test]

---

## Enterprise Quality

- No shortcuts, workarounds, or generic error messages
- No hardcoded config — admin-controllable
- API keys via database Integrations panel only
- No unused code ships — verify all code paths
- Make a real test API call when integrating any external service
- UI changes refresh immediately without page reload

---

## Architecture

Separation of concerns: frontend (UI only), backend (API, validation, auth, orchestration), services (`lib/`), routes (thin wrappers).

**Folder structure:**
```
app/
  page.tsx
  api/
    diagnostic/route.ts
    contact/route.ts
components/
  ui/ | diagnostic/ | layout/
lib/
  llm.ts | utils.ts
public/
  images/ | fonts/
wiki/
```

Never create `client/`, `server/`, or `models/`. All server logic in `app/api/`. All service logic in `lib/`. One `route.ts` per endpoint. Routes validate input, call `lib/`, return response — nothing else.

- All Claude API calls → `lib/model.ts`
- All scoring/report logic → `lib/diagnostic.ts`
- System prompt lives in the DB, not hardcoded
- No business logic inside API route handlers

---

## Database (Drizzle + PostgreSQL)

**No database work until explicitly requested. All schema changes require a migration file.**

Standards apply to all schema files, migrations, and ad-hoc SQL.

Every table: 2NF minimum. No transitive dependencies. No repeating groups or comma-separated values. Exception: pgvector `embedding` and JSONB audit columns where noted in a comment.

Analytics: strict star schema. `fact_` tables with numeric measures only. `dim_` tables for dimensions. Never mix OLTP and OLAP.

**Naming:**
| Object | Pattern | Example |
|---|---|---|
| Tables | snake_case singular | `recipe_version` |
| Primary key | `id` UUID | `id uuid primary key` |
| Foreign keys | `{table}_id` | `user_id` |
| Timestamps | `created_at`, `updated_at` | on every table |
| Booleans | `is_` or `has_` prefix | `is_published` |
| Junctions | both names, alphabetical | `ingredient_recipe` |

No camelCase in SQL. No abbreviations beyond `id`, `url`.

**Index rules:**
- Every FK gets an index — no exceptions
- Composite index when two+ columns consistently queried together
- Every index needs a comment stating the query it serves
- Partial indexes preferred for low-selectivity booleans
- pgvector columns use `ivfflat` index with `lists` tuned to dataset size

**Before any schema review confirm:**
1. Normal form the table satisfies
2. Every FK has an index
3. Naming violations flagged
4. OLTP vs OLAP identified and correct pattern applied
State any deviation explicitly with justification before proceeding.

**Drizzle rules:**
- Never `select *` — always specify columns
- Use `.prepare()` for repeated queries
- Log generated SQL in development — if it looks wrong, it is wrong
- Raw SQL for complex/OLAP queries — never force through ORM
- Always use connection pooling — never open raw connections

---

## TWO DATABASES — NEVER CONFLATE

| | DEV | PROD |
|---|---|---|
| Database | `archos_labs_dev` | `archos_labs_pdb` |
| Host | `127.0.0.1:5432`, PG18, no SSL | Render Singapore, SSL required |
| Comes from | `DATABASE_URL` in `.env.local` | `DATABASE_URL_RENDER_PROD`, commented in `.env.local`; Render injects its own at runtime |

**Check the `DATABASE_URL` host before claiming where data lives.** `127.0.0.1` + no SSL = DEV, full stop. Never trust prose over the host.

Every `db:*` script and seed hardcodes `--env-file=.env.local`, so all of it hits DEV by default. A shell-set `DATABASE_URL` overrides `--env-file` — that is both how you target PROD deliberately and how you hit it by accident. Never leave `DATABASE_URL` exported in your shell.

**PROD migrates by hand, one deliberate run per release.** `pg_dump` backup, check `__drizzle_applied` on PROD, then `DATABASE_URL="<PROD>" node scripts/db-apply.mjs` — idempotent, applies untracked migrations in order. No migrate-on-deploy hook; `build`/`start` are vanilla, so merging a PR ships code to PROD but never schema. PROD can silently lag DEV.

Schema is synced DEV↔PROD by hand. Data is not — DEV test data must never reach PROD.

If the user contradicts your architectural assumption, treat it as the architecture rewriting itself. Stop, re-read `wiki/entities/deployment-architecture.md`, update your model. Do not fit the user's words into an assumed pattern.

---

## Project

**Archos Labs** — archoslabs.xyz
- Tagline: Built by practitioners. For programs that can't afford to get it wrong.
- Voice: Direct. No corporate speak. No vanity metrics.
- Track 1: Senior data architecture and AI consulting (financial services, healthcare, government)
- Track 2: AI-powered tools — starting with the Executive AI Diagnostic

**Tech stack:** Next.js 16, App Router, TypeScript · Tailwind CSS · OpenRouter API · Render · pnpm

**Next.js rules:** App Router only. Server Components by default. `use client` only when necessary. `NEXT_PUBLIC_` prefix for client-side env vars only.

**Ports:** Dev port from `PORT` in `.env.local`. Default 3007. Never 3000. Render injects `PORT` at runtime — never hardcode in production.

**No prices, day rates, or dollar amounts on the site.** Pricing happens in conversation only.

---

## API

Rate limit: 100 requests per IP per hour on all endpoints.

**`POST /api/diagnostic`**
Request: `{ answers: [{ cluster, question, selected, context }] }`
Response: `{ tier, score, report: { snapshot, risks[], recommendations[], urgency } }`

**`POST /api/contact`**
Request: `{ name, email, organisation, message }`
Response: `{ success: true, message }`

Rules: never call LLM from client side. All Claude calls server-side via `lib/model.ts` only. Never expose API key. Validate all inputs. Return consistent error shapes. Never expose raw errors to client.

---

## Security

OWASP review required on every feature: Broken Access Control, Cryptographic Failures, Injection, Insecure Design, Misconfiguration, Outdated Components, Auth Failures, Data Integrity Failures, Logging Failures, SSRF, Prompt Injection.

**Security tests** — generate for every feature: validation unit tests, API integration tests, malicious input tests, auth/authorization tests, edge cases.

**Threat modeling** — evaluate for every new feature: attack surfaces, privilege escalation risks, data exposure risks, abuse scenarios, privacy risks.

Rules:
- Parameterized queries always
- Env vars for all secrets — never commit
- Least privilege access
- Never log diagnostic answers or report content
- Never store executive responses without explicit consent
- Sanitize all free-text before passing to model API
- Risk introduced → flag it, propose safer implementation, document mitigation

---

## UI/UX

Question for every interface decision: What would make users fanatical about this? Fanatical means they show it to someone else unprompted.

Rules:
- No stock photos
- Typography over decoration
- White space is confidence, not emptiness
- Loading states feel intentional
- Error messages in plain human language — never expose exceptions
- When in doubt, remove
- Ask: What would a top 0.1% designer think?

Test before shipping: Would a skeptical first-time user trust this enough to complete the flow and come back tomorrow?

---

## Git

`main` auto-deploys via Render. Branch protection active since 2026-05-11. CI must pass before merging — never bypass.

**Solo mode:** always ask for explicit confirmation before `git push`. Never push automatically.

- Small changes (< 3 files, config, wiki): commit to `main` directly
- Non-trivial: feature branch, max 2 days, merge `--no-ff`
- For incomplete features touching shared code: use feature flags
- Pull `main` before starting any new branch
- One feature per branch — never bundle unrelated changes
- PR descriptions: assume the next reader has zero context
- Code review required for non-trivial changes before merging
- Never rebase shared branches
- Never force push to `main`
- Never commit `.env` files
- Never skip pre-commit hooks (Husky + lint-staged: lint + format on staged files)

Branch naming: `feature/`, `fix/`, `hotfix/`, `chore/`

CI: `pnpm install --frozen-lockfile` → lint → `tsc --noEmit` → vitest → build. All must pass.

Commit format: `<verb> <area>: <detail>`

---

## Wiki

Read `wiki/index.md` at every session start. Review `wiki/lessons-learned/` at session start.

**Source of truth:**
- `wiki/state.md` — what is shipped. Auto-generated by `scripts/wiki-state.mjs`. Check before claiming anything is unbuilt. Glob filesystem if still uncertain. Backlog = planned, state register = reality.
- `wiki/entities/deployment-architecture.md` — runtime topology. Read before any session involving deploy, migration, environment, or release.

**Folders:**
- `entities/` — named things
- `concepts/` — patterns and ideas: architecture, data flow, RAG, voice persona
- `decisions/` — architectural decisions with date and rationale
- `synthesis/` — cross-cutting analysis, lessons, open questions
- `raw-index/` — pointer pages to source content elsewhere (Drive, Notion, large PDFs, client material)
- `raw/` — Karpathy Layer 1 sources checked in verbatim (small, public, worth preserving)
- `backlog/` — prioritised build list, ordered by what matters most
- `lessons-learned/` — Problem / Fix / Rule. After any user correction or significant decision: write here.

**Page format:**
```
---
title:
category: [entity|concept|decision|synthesis|raw-index]
created: YYYY-MM-DD
updated: YYYY-MM-DD
related: [[slug]]
---
```

Always update `wiki/index.md` when creating a page. Always append `wiki/log.md` after every session.

**Ingest** (`pnpm wiki:ingest --url <url>` | `--file <path>` | `--paste --slug <slug>`):
1. Add `--in-repo` for small public sources → `wiki/raw/`. Else `--external` → `wiki/raw-index/`
2. Read the placed page in full
3. Open every overlapping page from the checklist — update, add `[[slug]]` cross-ref, bump `updated:`
4. Create new `entities/` or `concepts/` pages if source introduces new subjects
5. Update `wiki/index.md`
6. Append `wiki/log.md` with `## YYYY-MM-DD — Ingest: <title>`, list touched pages
7. `pnpm wiki:graph build`
8. `pnpm wiki:lint`

Single ingest touches 3–10 pages. If not touching other pages, source belongs in `raw-index/` only.

**Lint** (`pnpm wiki:lint`) — run at: session start when wiki >50 pages; before any PR touching `wiki/`; after every ingest. Hard errors (broken refs, missing frontmatter, index drift) → fix first. Warnings → triage. Contradictions or stale claims → surface to user, never silently overwrite.

**Query** — run `pnpm wiki:search` and `pnpm wiki:graph neighbors <slug>` before opening full pages. Cite pages used as `[[slug]]`. If synthesis is reusable, write to `wiki/synthesis/`.

**Graph** (`pnpm wiki:graph`): `build` (run after any `related:` or `[[slug]]` edit), `stats`, `neighbors <slug>`, `orphans`, `category <name>`, `broken`. `wiki/.graph.json` is gitignored — regenerable artefact.

---

## gstack (REQUIRED)

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Install before proceeding:
```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skill routing: `/office-hours` (ideas) → `/plan-ceo-review` (strategy) → `/plan-eng-review` (architecture) → `/investigate` (bugs) → `/qa` (testing) → `/review` (code) → `/design-review` (visual) → `/ship` (deploy) → `/spec` (backlog)