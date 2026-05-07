# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- Role play as Nobel Laureate solving this problem

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

------------------------------------------------------------------------

# Project Overview

#### What Is Archos Labs

Archos Labs is an AI transformation practice and product studio built by a practitioner for programs that can't afford to get it wrong.

It operates on two tracks simultaneously:

**Track 1 — Consulting** Senior data architecture and AI integration consulting for enterprise programs in financial services, healthcare, and government.

**Track 2 — Products** AI-powered tools built from 25 years of enterprise delivery experience — starting with the Executive AI Diagnostic.

---

#### The Problem Archos Labs Solves

Most AI transformation programs fail not because of the models. They fail because the data underneath them was never ready — ungoverned, unmodelled, and unfit for the decisions being made on top of it.

The people who understand this deeply enough to fix it are either inside Big Four firms charging $2,500 a day or buried inside enterprise programs with no external presence.

Archos Labs sits in the gap.

---

#### What Lives at archoslabs.xyz

**The HQ has four sections:**

**1\. Home** Who we are. What we solve. Who we work with. The filter that tells the right client to stay and the wrong client to leave.

**2\. Tools** AI-powered diagnostic and assessment tools built from enterprise delivery experience. Starting with the Executive AI Diagnostic. More tools added as Archos Labs grows.

**3\. Consulting** The three service lines — AI Readiness Assessment, Data Architecture, AI Agent Development. How to engage. Day rate and fixed price options.

**4\. The Modelling Room** Link to the LinkedIn newsletter. Thought leadership. The publication that builds the audience that feeds the pipeline.

---

#### Revenue Model

**Immediate — Consulting** Day rate $1,100 AUD. Fixed price engagements starting at $3,000 AUD for AI Readiness Assessments. Available immediately.

**Medium term — Tool-led consulting** Executive AI Diagnostic generates leads. Leads convert to paid calls. Paid calls convert to consulting engagements.

**Long term — Productised services** Standardised assessment packages. Workshop delivery. Eventually recurring revenue from tools.

---

#### The Brand

**Name:** Archos Labs

**Domain:** archoslabs.xyz

**Tagline:** Built by practitioners. For programs that can't afford to get it wrong.

**Voice:** Direct. Honest. No corporate speak. No vanity metrics. No Big Four padding.

**Positioning:** The practitioner alternative to Big Four consulting — faster, cheaper, more specific, more accountable.

---

#### Tech Stack

-   **Framework:** Next.js 15 — App Router — TypeScript
-   **Styling:** Tailwind CSS
-   **AI:** OpenRouter API
-   **Deployment:** Render
-   **Domain:** archoslabs.xyz
-   **Package Manager:** pnpm

#### Future Stack (add when needed)
-   **Database:** PostgreSQL — Neon (serverless) — Drizzle ORM
-   **Auth:** Clerk or NextAuth
-   **Email:** Resend

---

#### What This Is Not

-   Not a Big Four competitor on scale
-   Not a product company pretending to be a consulting firm
-   Not a blog with a contact form

---

#### What This Is

A practitioner-led studio where enterprise experience becomes accessible tooling and honest consulting — for the programs that need it most and can't afford to get it wrong.

------------------------------------------------------------------------

Project Rules for the Project

------------------------------------------------------------------------

# Workflow Orchestration

## 1. Plan Mode Default

-   Enter plan mode for ANY non-trivial task (3+ steps or architectural
    decisions)
-   If something goes sideways, STOP and re-plan immediately --- do not
    keep pushing
-   Use plan mode for verification steps, not just building
-   Write detailed specs upfront to reduce ambiguity

## 2. Subagent Strategy

-   Spawn subagents liberally to keep main context window clean
-   Offload research, exploration, and parallel analysis to subagents
-   For complex problems, use multiple subagents for parallel reasoning
-   One task per subagent for focused execution
-   It is MANDATORY for Subagents to do their stand up to ensure every agent is aligned

## 3. Verification Before Done

-   Never mark a task done or complete without proving it works
-   Diff behavior between main and your changes when relevant
-   Ask: "Would a staff engineer approve this?"
-   Run tests, check logs, demonstrate correctness
-   When any user-facing feature is added or modified, the corresponding `wiki/` file must be created or updated before the task is marked complete

## 4. Demand Elegance (Balanced)

-   For non-trivial changes ask: "What would a top 0.1% person in this field think?"
-   If a fix feels hacky, refactor before presenting
-   Avoid over-engineering simple problems

## 5. Autonomous Bug Fixing

-   When given a bug report: investigate logs and errors and resolve it
-   Do not require the user to guide debugging steps
-   Fix failing tests and CI issues independently when possible
-   ALWAYS follow the Debugging Protocol

## 6. Testing Standards

Act as a senior QA engineer. Test at the smallest level possible.

When a new feature is added, generate:

1.  Unit tests — for services, utilities, and pure functions
2.  Integration tests — for API routes with real database
3.  End-to-end tests — for full user flows
4.  Edge cases and failure scenarios
5.  Penetration tests - for hardening cybersecurity

Rules:

-   Every new service function needs a unit test
-   Every new API endpoint needs an integration test and penetration test
-   Every user-facing feature needs at least one E2E test
-   Test the unhappy path: invalid input, missing auth, rate limits,
    edge cases

### Regression Testing Protocol

After every new feature, before marking work complete:

1. Run the full test suite: `pnpm test`
2. Run integration tests: `pnpm test:integration`
3. Check for TypeScript errors: `pnpm tsc`
4. If any DB schema changes were made, run `drizzle-kit push` (from `packages/server/`) to sync the remote database
5. **MANDATORY: Test every new/updated API route via curl or ctx_execute fetch:**
   - List every route the feature touches
   - Verify 200 + correct response shape for happy path
   - Verify 401 without token
   - Verify 404/400 for invalid params
   - Only wire the frontend AFTER backend routes are verified
6. Smoke test all affected routes and list them in your task summary
7. Confirm no existing tests were broken, modified, or deleted without justification
8. Report pass/fail results before closing the task

Never consider a feature DONE until all existing tests pass, the database schema is in sync, and all API routes are verified via curl.

## 8. Enterprise Code Quality

Every change must meet production-grade standards:

-   No shortcuts, workarounds, or "good enough" implementations
-   Every feature must be tested end-to-end before marking complete
-   Error handling must be specific and actionable (no generic messages)
-   Configuration must be admin-controllable (no hardcoded values that users need to change)
-   API keys and credentials must be database-driven via the Integrations panel
-   UI changes must refresh immediately without requiring a page reload
-   Unused or experimental code must not ship — verify all code paths work
-   When integrating any external API, make a real test call during implementation to verify the endpoint/model/key works

## 9. Debugging Protocol (MANDATORY)

ALWAYS Follow this sequence strictly. Do not skip steps.

1. Read the error output exactly as written. Do not interpret.
2. Identify the exact file, line, and function where the error originates.
3. State only what the error message confirms. Label anything else [Inference].
4. Do not suggest a fix until root cause is confirmed by evidence in the code or logs.
5. If root cause cannot be determined from available information, state: "I need more information." Then list exactly what information is needed.
6. Never guess. Never patch. Never suggest multiple fixes hoping one works.
7. One confirmed problem. One evidence-based fix. One test to verify.

### Investigation Format

Every debugging response must follow this structure:

- Confirmed: [what the error proves]
- Evidence: [exact file, line, log output]
- Root cause: [only if confirmed by evidence]
- Fix: [only after root cause is confirmed]
- Verify with: [exact command or test]

------------------------------------------------------------------------

# Architecture Principles

The system must follow:

-   Separation of concerns
-   Modular architecture
-   Maintainable code
-   Scalable services
-   Clear folder structure

Frontend, backend, AI services, prompts, and knowledge content must
remain separated.

## Database Design — Mandatory Standards

Apply these rules to ALL database work in this project, including migrations,
schema files, Drizzle ORM definitions, and any ad-hoc SQL.

---

### 1. Normalization (2NF)

- Every table must be in Second Normal Form before review.
- No transitive dependencies. Each non-key column depends only on the primary key.
- Repeating groups, comma-separated values, and JSON blobs used as relational
  columns are not allowed.
- Exception: pgvector `embedding` columns and JSONB audit/metadata columns
  are permitted where explicitly noted in a comment.

---

### 2. Star Schema (Analytics Layer)

- Separate OLTP tables (normalized, transactional) from OLAP tables
  (denormalized, reporting).
- Analytics tables follow strict star schema:
  - One central fact table per analytical domain (e.g. `fact_usage`)
  - Dimension tables prefixed with `dim_` (e.g. `dim_user`, `dim_role`)
  - Fact tables hold foreign keys to dimensions and numeric measures only.
  - No dimension data lives inside a fact table.
- Do not mix OLTP and OLAP concerns in the same table.

---

### 3. Naming Conventions

| Object           | Pattern                          | Example                     |
| ---------------- | -------------------------------- | --------------------------- |
| Tables           | `snake_case`, singular noun        | `recipe_version`           |
| Primary key      | `id` (UUID preferred)            | `id uuid primary key`       |
| Foreign keys     | `{referenced_table_singular}_id` | `user_id`, `recipe_id`      |
| Timestamps       | `created_at`, `updated_at`       | standard on every table     |
| Boolean cols     | `is_` or `has_` prefix           | `is_published`, `has_image` |
| Junction tables  | both entity names, alphabetical  | `ingredient_recipe`         |

- No abbreviations unless universally understood (e.g. `id`, `url`).
- No camelCase in SQL or schema files.

---

### 4. Index Strategy

- Every foreign key column gets an index. No exceptions.
- Add a composite index when two or more columns are consistently queried together.
- Unique constraints replace unique indexes wherever the constraint is semantic
  (e.g. `unique(user_id, recipe_id)` on a junction table).
- pgvector columns use `ivfflat` index with `lists` tuned to dataset size.
- Do not add indexes speculatively. Every index must have a stated query it serves,
  written as a comment directly above the index definition.
- Partial indexes are preferred over full indexes for low-selectivity boolean
  columns (e.g. `WHERE is_published = true`).

---

### Enforcement

Before generating or reviewing any schema:

1. State which normal form the table satisfies.
2. Confirm every FK has an index.
3. Flag any column that violates naming conventions.
4. Identify whether the table is OLTP or OLAP and confirm it follows the
   correct design pattern for that layer.

If a design decision deviates from any rule above, state the deviation
explicitly and provide a justification before proceeding.

------------------------------------------------------------------------

# Project Folder Structure

This is a **Next.js application** built with the App Router pattern.
All application code lives under `src/` or directly in `app/`.

cc-archos-labs/

  app/
    page.tsx                    ← Home
    api/
      diagnostic/
        route.ts                ← LLM API call for report generation
      contact/
        route.ts                ← Contact / booking form handler

  components/
    ui/                         ← Reusable UI components
    diagnostic/                 ← Diagnostic tool components
    layout/                     ← Header, Footer, Nav

  lib/
    llm.ts                      ← LLM client setup
    utils.ts                    ← Shared utilities

  public/
    images/
    fonts/

  wiki/
    index.md                    ← Master catalog of all wiki pages
    log.md                      ← Append-only session log
    entities/                   ← Named things: Archos Labs, Executive AI Diagnostic,
                                   AI Readiness Assessment, Rob Angeles
    concepts/                   ← Patterns and ideas: diagnostic scoring logic,
                                   report generation architecture, SEO/AIEO strategy
    decisions/                  ← Architectural decisions with date and rationale
    synthesis/                  ← Cross-cutting analysis, lessons, open questions
    raw-index/                  ← Pointer pages to source content elsewhere
    backlog/                    ← Prioritised build list ordered by what matters most
    lessons-learned/            ← Problem / Fix / Rule format. Never repeat mistakes.


Claude must follow this structure when generating code. Never create a separate client/ or server/ directory. Next.js API routes handle all server-side logic. Never create a models/ folder — if a database is added later, use Drizzle ORM schema files inside lib/db/.

------------------------------------------------------------------------

# Separation of Concerns

## Frontend

Responsibilities:

-   UI rendering
-   chat interface
-   API communication
-   state management

Rules:

-   HTML contains structure only
-   CSS contains styling only
-   JavaScript handles UI behavior
-   No business logic allowed

------------------------------------------------------------------------

## Backend

Responsibilities:

-   API endpoints
-   request validation
-   authentication
-   orchestration of services

Backend must never contain frontend UI logic.

------------------------------------------------------------------------

## Services Layer

Location:

    lib/

All service logic lives in `lib/` as standalone TypeScript modules.
No separate services directory. Next.js API routes import directly
from `lib/`.

Examples:

    lib/claude.ts         ← Anthropic client setup and API calls
    lib/diagnostic.ts     ← Scoring logic and report generation
    lib/utils.ts          ← Shared utilities

Responsibilities:

- `model.ts` — construct prompts, call model API, return responses
- `diagnostic.ts` — score answers, determine tier, format report data
- `utils.ts` — shared helpers, input validation, formatting

## Rules

- API routes must never call model API directly
- All model API calls go through `lib/model.ts`
- All scoring and report logic lives in `lib/diagnostic.ts`
- Keep `lib/` files small and focused — one responsibility per file
- No business logic inside API route handlers

------------------------------------------------------------------------

## Routes

Location:

    app/api/

Next.js App Router uses `route.ts` files as route handlers.
There are no separate route or controller files.

Route handlers must remain thin:

- Validate incoming request
- Call the appropriate `lib/` service
- Return the response

Example:

    app/api/diagnostic/route.ts

    export async function POST(request: Request) {
      const body = await request.json()
      // 1. Validate input
      // 2. Call lib/diagnostic.ts
      // 3. Return response
    }

## Rules

- One `route.ts` per API endpoint
- No business logic inside route handlers
- No direct model API calls inside route handlers
- All logic lives in `lib/` — routes just wire things together
- Always validate input before passing to services
- Always return consistent error shapes

------------------------------------------------------------------------

## Database / Models

Location:

    lib/db/
      schema.ts     ← Drizzle ORM table definitions
      index.ts      ← Database client setup

    drizzle/        ← Migration files managed by drizzle-kit

The project uses **Drizzle ORM** with **PostgreSQL via Neon** (serverless).
There is no `models/` folder. Database entities are defined as Drizzle
table schemas in `lib/db/schema.ts`. Migrations are managed via
`drizzle-kit`.


## Rules
- No database work until explicitly requested
- All schema changes require a migration file
- Follow Database Design Standards defined

------------------------------------------------------------------------

# UI/UX Standards

## The Obsession Virus

Every interface decision must ask one question:
**What would make users fanatical about this?**

Not satisfied. Not impressed. Fanatical.

Fanatical means they show it to someone else unprompted.
Fanatical means they come back before they need to.
Fanatical means they trust it before they've verified it.

## Principles

**Calm confidence.** The UI should feel like it was designed by someone
who deeply understands the user's world. No clutter. No noise.
Every element earns its place or gets removed.

**Frictionless clarity.** The user should never have to think about
how to use it. If they pause, we failed.

**Specificity over generality.** Generic outputs get ignored. Outputs
that feel made for the user get shared with others.

**Speed signals respect.** Slow interfaces signal that you don't value
the user's time. Every interaction must feel instant.

**Trust before delight.** The UI must feel credible before it feels
beautiful. A user won't be delighted by something they don't trust.

## Rules

- Mobile first. Users are always on their phone.
- No stock photos. No generic imagery.
- Typography does the heavy lifting — not decorations.
- White space is not empty space. It is confidence.
- Every loading state must feel intentional — not like waiting.
- Error messages must be plain human language — never expose technical errors or exceptions.
- When in doubt, remove. Complexity is the enemy of trust.
- Outputs must look worth sharing — not worth closing.
- Ask: What would a top 0.1% creative director think?

## The Test

Before shipping any UI change ask:
**Would a skeptical first-time user trust this enough to complete
the flow and come back tomorrow?**

If the answer is uncertain — redesign.

## The Standard

Ask: **"What would a top 0.1% designer think of this?"**

If the answer is "they would simplify it" — simplify it.
If the answer is "they would remove something" — remove it.
If the answer is "they would be proud of it" — ship it.

------------------------------------------------------------------------

# # API Design

All API routes live in `app/api/` following Next.js App Router conventions.
Route handlers use the `route.ts` filename pattern.

Examples: 

Diagnostic Endpoint

    POST /api/diagnostic

Request:

    {
      "answers": [
        {
          "cluster": "AI Investment & Budget",
          "question": "When your team tells you the numbers are correct...",
          "selected": "C",
          "context": "Optional executive free-text input"
        }
      ]
    }

Response:

    {
      "tier": "At Risk",
      "score": 68,
      "report": {
        "snapshot": "Your AI program has foundational gaps...",
        "risks": ["Data lineage undocumented", "Legacy systems unvalidated"],
        "recommendations": ["...", "...", "..."],
        "urgency": "Three of your five clusters show critical gaps..."
      }
    }

Contact / Booking Endpoint

    POST /api/contact

Request:

    {
      "name": "Jane Smith",
      "email": "jane@jao.com.au",
      "organisation": "Just Another Organisation",
      "message": "We completed the diagnostic and want to discuss next steps."
    }

Response:

    { "success": true, "message": "We'll be in touch within 24 hours." }

## Rules

- API routes must never call LLM APIs from the client side
- All Claude API calls happen server-side in route handlers only
- Never expose the Anthropic API key to the client
- Validate all inputs before passing to Claude
- Rate limit the diagnostic endpoint — max 100 requests per IP per hour

------------------------------------------------------------------------

# AI Integration

AI service location:

    lib/claude.ts

Responsibilities:

- Initialise Anthropic client
- Construct prompts from diagnostic answers
- Call model API
- Return structured report response

## Rules

- Routes must never call model API directly
- All Claude API calls go through `lib/model.ts`
- System prompt should live in the DB
- Always handle API errors gracefully — never expose raw errors to client
- Never log diagnostic answers or report content — privacy first

## Example

    // lib/model.ts
    import Anthropic from '@anthropic-ai/sdk'

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

    export async function generateDiagnosticReport(answers: DiagnosticAnswers) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: buildPrompt(answers) }]
      })
      return response.content[0].text
    }

------------------------------------------------------------------------

# Security Guidelines

-   Store API keys in environment variables
-   Never commit secrets
-   Validate all request inputs
-   Sanitize user data
-   Implement rate limiting

------------------------------------------------------------------------

# Code Quality Rules

-   Keep files small and focused
-   Prefer modular functions
-   Avoid deeply nested logic
-   Use descriptive variable names
-   Avoid duplicated logic
-   Every code is properly documented using plain human language

---

# When Generating Code

Claude must:

-   follow the folder structure
-   maintain separation of concerns
-   keep files modular
-   avoid monolithic code
-   generate production-quality implementations

## Next.js Rules
- Use App Router only. Never Pages Router.
- API routes live in app/api/ only. Never create a separate server.
- Server Components by default. Use 'use client' only when necessary.
- Environment variables prefixed with NEXT_PUBLIC_ for client-side only.

# Security and Testing Standards (MANDATORY)

Security must be considered during development, not after.

All new functionality must include security review and testing aligned with OWASP principles.

## Security Review Requirements

When generating or modifying code:

- Review for common vulnerabilities
- Validate input handling
- Ensure proper authentication and authorization
- Prevent injection vulnerabilities
- Avoid hardcoded secrets
- Validate external dependencies
- Ensure secure configuration defaults

## OWASP Risk Categories

Code and APIs must be reviewed for the following classes of risk:

1. Broken Access Control
2. Cryptographic Failures
3. Injection Vulnerabilities
4. Insecure Design
5. Security Misconfiguration
6. Vulnerable or Outdated Components
7. Authentication Failures
8. Software and Data Integrity Failures
9. Logging and Monitoring Failures
10. Server-Side Request Forgery (SSRF)
11. Prompt Injection

## Security Testing Expectations

When implementing a feature Claude must generate:

- Unit tests for validation logic
- Integration tests for API and service communication
- Security tests for malicious inputs
- Authentication and authorization tests
- Edge-case and failure scenario tests

## Threat Modeling

For new features Claude should evaluate:

- potential attack surfaces
- privilege escalation risks
- data exposure risks
- abuse scenarios
- privacy risks
- cybersecurity risks

## Secure Coding Practices

Claude must prefer:

- parameterized queries
- strict input validation
- least privilege access
- strong encryption libraries
- environment variables for secrets
- dependency vulnerability checks
- test driven development
- never log diagnostic answers or report content
- never store executive responses without explicit consent
- rate limit all API endpoints — max 100 requests per IP per hour
- sanitize all free-text inputs before passing to model API

## Security and Privacy First Principle

If a feature introduces security and privacy risk, Claude must:

- flag the risk
- propose a safer implementation
- document the mitigation
- Ask: What would a top 0.1% person in this field think?

------------------------------------------------------------------------

# Git Workflow — Trunk-Based Development

`main` is the trunk. Every push auto-deploys via Render. CI must pass.

## Rules

- **MANDATORY**: CI pipeline (GitHub Actions) must pass before merging. Never bypass.
- **MANDATORY**: When working solo with Claude Code — always ask for
  explicit user confirmation before running `git push`. Never push automatically.
- **MANDATORY**: When working with multiple developers — each developer
  owns their own pushes. Claude Code does not push on behalf of other developers.
- Small changes (< 3 files, config, wiki): commit directly to `main`
- Non-trivial changes: short-lived feature branch (max 2 days)
- Merge to `main` with `--no-ff` when CI passes
- For incomplete features touching shared code: use feature flags
- Pre-commit hooks (Husky + lint-staged) run lint + format on staged files

## Multi-Developer Rules

- Never rebase shared branches — use merge only
- Never force push to `main` under any circumstance
- Pull `main` before starting any new branch
- Communicate in PR descriptions — assume the next reader has no context
- One feature per branch — never bundle unrelated changes
- If two developers touch the same file — resolve conflicts before merging
- Code review required for non-trivial changes before merge to `main`

## Branch Naming

    feature/diagnostic-scoring-logic
    fix/report-generation-timeout
    hotfix/claude-api-rate-limit
    chore/update-dependencies

## CI Pipeline (GitHub Actions)

Every push and PR to `main` runs:

    1. pnpm install --frozen-lockfile
    2. Lint (eslint)
    3. TypeScript check (tsc --noEmit)
    4. Unit tests (vitest)
    5. Build (pnpm build)

All steps must pass. No exceptions.

## Merge Flow

    git checkout main
    git pull origin main
    git checkout -b feature/my-feature
    # ... work and commit (keep branch < 2 days) ...
    # Push branch, CI runs automatically
    git checkout main
    git pull origin main
    git merge feature/my-feature --no-ff
    # Solo: confirm with user before pushing
    # Multi-dev: developer owns this push
    git push origin main
    git branch -d feature/my-feature

## Commit Message Format

    <verb> <area>: <detail>

    Examples:
    Add diagnostic scoring endpoint
    Fix Claude API timeout handling
    Update report generation prompt
    Chore update pnpm dependencies

## Never

- Push to any remote without explicit user confirmation (solo mode)
- Force push to main
- Push broken code to `main`
- Commit `.env` files or secrets
- Skip pre-commit hooks (--no-verify)
- Let a feature branch live longer than 2 days
- Rebase a branch another developer is working on

------------------------------------------------------------------------

# Local Development Ports

- Next.js dev server: 3007 (local only)
- Render uses PORT environment variable in production
- Never hardcode port 3007 in production code
- Never default to port 3000

------------------------------------------------------------------------

# LLM Wiki

This project maintains a living knowledge wiki in `wiki/`.

## At the start of every session
Read `wiki/index.md` to understand what is already known before doing any work.

## During the session
When you make a significant decision, discover a non-obvious pattern, or implement
something architecturally important — write it to the appropriate wiki folder.

## At the end of every session
Update `wiki/log.md` with a summary of what was done and decided today.

## Wiki rules
- `wiki/entities/` — named things: Antoine, Sparq, RAG pipeline, subscription system, store locations, prompt system
- `wiki/concepts/` — patterns and ideas: technical architecture, data flow, fine-tuning approach, RAG architecture, voice persona design
- `wiki/decisions/` — architectural decisions with date and rationale
- `wiki/synthesis/` — cross-cutting analysis, lessons, open questions
- `wiki/raw-index/` — pointer pages to source content that lives elsewhere. The wiki documents these without owning or relocating them.
- `wiki/backlog/` - a prioritised list of work that needs to be done, ordered by what matters most right now. Every component we need to build will be listed here. Always read this when sessions start.
- `wiki/lessons-learned/` - After ANY correction from the user: update `wiki/lessons-learned/`. After ANY significant implementation, architectural decision, or non-obvious bug fix: record it in `wiki/essons-learned/`. Format: Problem / Fix / Rule. Write rules that prevent repeating mistakes. Review lessons-learned at session start
- `raw/` is conceptual — there is no literal `raw/` folder. 
- Always update `wiki/index.md` when creating a new wiki page
- Always append to `wiki/log.md` when modifying the wiki

## Wiki page format
Every wiki page must start with:

```
---
title: [page title]
category: [entity | concept | decision | synthesis | raw-index]
created: [YYYY-MM-DD]
updated: [YYYY-MM-DD]
related: [[page-name]], [[page-name]]
---

[one sentence summary]

[content]
```

## Wiki tooling (use BEFORE reading full pages)

The wiki ships with two small Node scripts. Reach for them whenever the wiki has more than a handful of pages — they keep token use down by narrowing what you have to `Read` in full.

**Level 2 — local search (`scripts/wiki-search.mjs`)**
```
node scripts/wiki-search.mjs <query>            # list matching wiki page paths
node scripts/wiki-search.mjs -c <query>         # show 2 lines of context per match
```

**Level 4 — graph relationships (`scripts/wiki-graph.mjs`)**
```
node scripts/wiki-graph.mjs build               # rebuild wiki/.graph.json from frontmatter + [[refs]]
node scripts/wiki-graph.mjs stats               # node/edge counts, category breakdown
node scripts/wiki-graph.mjs neighbors <slug>    # outgoing + incoming edges for a page
node scripts/wiki-graph.mjs orphans             # pages with no edges (likely under-linked)
node scripts/wiki-graph.mjs category <name>     # all pages in a category
node scripts/wiki-graph.mjs broken              # [[slug]] refs that point to missing pages
```

The graph is rebuilt on demand. After adding or editing a wiki page's `related:` frontmatter or any `[[slug]]` body reference, run `build` again. `wiki/.graph.json` is gitignored — it is a regenerable artefact.

When the graph crosses ~1000 nodes, swap the JSON store for SQLite via Node's built-in `node:sqlite` (Node 22+, no new deps). The `nodes` and `edges` arrays map cleanly to two tables.
