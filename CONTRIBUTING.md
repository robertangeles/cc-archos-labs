# Contributing to Archos Labs

Read this before your first commit. Skim `CLAUDE.md` next — it has the deeper architecture and code-quality rules.

## Getting started

```bash
git clone https://github.com/robertangeles/cc-archos-labs.git
cd cc-archos-labs
pnpm install
cp .env.example .env.local   # then fill in real values — see below
pnpm db:migrate              # apply Drizzle migrations to your DATABASE_URL
pnpm dev                     # http://localhost:3007
```

### Required env vars

`.env.example` documents every variable. The ones you'll need on day one:

- `DATABASE_URL` — ask Rob for a dev Postgres URL (Render External Database URL).
- `AUTH_SECRET` — any 32-byte base64; doesn't need to match prod. Generate with `openssl rand -base64 32`.
- `ADMIN_PASSWORD` — anything for local; `archos-admin-dev-pw` is fine.
- `OPENROUTER_API_KEY` — ask Rob (only needed if you're touching `/api/diagnostic/generate`).
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CONTACT_RECIPIENT_EMAIL` — only needed if you're touching the contact form or magic-link auth.

Never commit `.env.local`. It's gitignored — keep it that way.

## Morning routine

Run before any new work:

```bash
pnpm wip            # see what the other dev is working on right now
pnpm new-branch feature/<short-name>   # branches from latest origin/main in one shot
```

`pnpm wip` reports open PRs (with CI status + commits-behind-main), open feature branches without PRs, and the last 5 commits to `main`. Gives you the "what's in flight" picture in one command so you don't pick up the same backlog item the other dev just started.

`pnpm new-branch` refuses to run if your working tree is dirty, fetches `origin`, fast-forwards `main`, and creates the branch — all in one step. If you skip this and branch from a stale local `main`, GitHub's "Require branches to be up to date" rule will block the merge later.

## Catching up an open branch when main moved

If the other dev (or you) merged something to `main` while your branch was already open, your branch is now stale. GitHub flags it as "out-of-date with the base branch" and refuses the merge. One command resolves it:

```bash
pnpm sync-branch     # fetch + rebase your branch onto origin/main + push --force-with-lease
```

`pnpm sync-branch` refuses if the working tree is dirty or you're on `main`. If the rebase produces a conflict, it leaves the rebase in progress for you to resolve manually (`git rebase --continue` after fixing, or `git rebase --abort` to bail out) and run again. If the branch hasn't been pushed yet, it skips the push and reminds you of the upstream-set command.

## Workflow

`main` is protected. You cannot push directly. Every change goes through a PR.

```bash
pnpm new-branch feature/short-descriptive-name
# ... work ...
git commit -m "Verb noun: brief detail"
git push -u origin feature/short-descriptive-name
gh pr create   # or open in the GitHub UI
```

Then:

1. CI runs automatically on the PR (lint + typecheck + test + build + migration safety).
2. Wait for green.
3. Request review from Rob (CODEOWNERS does this automatically).
4. Address feedback by pushing more commits to the branch.
5. Once approved + CI green, **squash-merge** the PR (linear history is enforced).
6. Delete your branch.

Keep branches short-lived. If a branch is open more than two days, something is probably wrong with the scope.

## Backlog-claim convention

Before picking up a backlog item from `wiki/backlog/backlog.md`:

1. Edit that file — add `[Rob, 2026-05-12]` (or `[Dev2, 2026-05-12]`) after the item heading.
2. Commit + push that one-line change directly to `main` via admin bypass. Tiny doc-only commit, no PR needed.
3. The other dev sees it on their next `pnpm wip` (recent commits to main).
4. The PR that ships the item removes the claim line.

Cost: one tiny commit per item. Benefit: no two-devs-on-the-same-item collisions.

## Bypass conventions

Admin-role bypass-merge is fine for:

- UI changes, copy edits, additive code (new components, new utilities)
- Additive schema (new tables, new columns)
- Test additions, doc updates
- Wiki edits

Admin-role bypass-merge is **NOT** fine for these — they need an explicit "approved" reply in the PR thread from the OTHER dev before merge:

- Any PR with the `migration-destructive` label
- Any PR that deletes code the other dev wrote
- Any PR that touches `lib/diagnostic/` core engine (scoring, content, prompt loaders)
- Any PR that changes branch-protection rules or CI workflow files

CI doesn't enforce this — it's a discipline layer. The migration-safety check (CI step that runs `scripts/_check-migration-safety.mjs --ci`) does enforce the destructive-SQL gate; convention covers the rest.

## Destructive migrations

If you write a Drizzle migration that contains a destructive op (DROP TABLE, DROP COLUMN, TRUNCATE, DELETE FROM without WHERE, ALTER ... DROP), CI will block the PR unless you do one of the following:

1. Add the **`migration-destructive`** label to the PR on GitHub.
2. Add this as the first line of the destructive .sql file:
   ```sql
   -- safety: verified against origin/main on YYYY-MM-DD by <your name>
   ```

Either path signals you've done the homework: `git fetch origin && git grep <symbol> origin/main`, and checked the `__drizzle_applied` state on Render to know what's actually deployed. See `wiki/lessons-learned/2026-05-12-schema-drift-needs-origin-main-check.md` for the incident this rule exists to prevent.

Local pre-push prints a warning when destructive SQL is detected but doesn't block — the gate is in CI so the label-override path works.

## Automated sync nudges

Two background checks watch for stale-branch problems:

- **`pnpm dev` / `pnpm dev:fresh`** — at startup, fetches `origin/main` and prints a one-line warning if your local `main` is behind. Doesn't block. Cheap fetch (~200ms).
- **`git push`** — Husky `pre-push` hook fetches `origin/main` and warns if your feature branch hasn't been rebased onto the latest. Doesn't block — branch protection on `main` is the real gate.

Both checks exit silently when you're in sync. They're nudges, not guards. If you see a warning, rebase before continuing:

```powershell
git fetch origin
git rebase origin/main
git push --force-with-lease   # if you'd already pushed the branch
```

## Local checks before opening a PR

```bash
pnpm lint     # ESLint
pnpm tsc      # TypeScript no-emit
pnpm test     # Vitest
pnpm build    # Next.js production build
```

CI runs the same four. If they pass locally, the PR should go green. Pre-commit (Husky + lint-staged) only fixes lint on staged files — it doesn't run the full suite, so you still want the four commands above before pushing.

## First-deploy admin seeding

After cloning to a fresh database, three admin rows need to be seeded once:

1. **`/admin/site`** — SEO & Brand defaults (already covered by the existing admin work).
2. **`/admin/prompts`** — the diagnostic system prompt. Until this row is set, the AI Readiness Assessment generates reports using a deliberately-generic fallback prompt — the practitioner-voice prompt is not in source (it's IP). Ask Rob for the latest prompt and paste it into the admin page, save.
3. **`/admin/diagnostic`** — the diagnostic content (questions, scoring, risk flag rules, priority triggers, tier boundaries, domain weights). Until this row is set, the assessment renders a single placeholder question. To recover the original from git history:

```bash
pnpm extract-content                       # default: from commit dcd6652, stdout
pnpm extract-content dcd6652 out.json      # write to file for review/paste
```

The script materialises a detached git worktree at the historic commit, evaluates the source `lib/diagnostic/content.ts` via Node's built-in TypeScript support, and emits a `DiagnosticContent`-shaped JSON blob. Paste the output into `/admin/diagnostic` and save.

If you see "Fallback prompt active" or "Fallback content active" banners on the corresponding admin pages, that row hasn't been seeded yet.

## Code rules to know

The full ruleset is in `CLAUDE.md`. The ones you'll trip over first:

- **Folder structure.** Next.js App Router. API routes live in `app/api/`. Business logic in `lib/`. No `services/`, no `controllers/`, no `models/`. Database schemas in `lib/db/schema.ts`.
- **Server vs client components.** Server by default. Add `"use client"` only when you need state, effects, or browser APIs.
- **No business logic in route handlers.** A `route.ts` validates input, calls a `lib/` function, returns. That's it.
- **Database is Drizzle + Postgres.** Read `CLAUDE.md` section "Make Drizzle Not Suffer" before writing queries. Never `select()` without explicit columns.
- **Naming**: tables `snake_case` singular, FKs always indexed, every table has `created_at` + `updated_at`. 2NF strict.
- **No prices on the public site.** No `$X`, no day rates, no fixed-price numbers in user-facing pages. Pricing happens in conversation.
- **No emojis in code or commits** unless explicitly requested.

## Wiki

Project knowledge lives in `wiki/`. Read `wiki/index.md` at the start of any non-trivial session. When you make a non-obvious architectural decision or hit a non-obvious bug, write it up in the appropriate folder:

- `wiki/concepts/` — patterns and ideas
- `wiki/decisions/` — architectural decisions with date + rationale
- `wiki/lessons-learned/` — Problem / Fix / Rule for things we shouldn't repeat
- `wiki/backlog/backlog.md` — prioritised build list

After any wiki edit, append a one-line summary to `wiki/log.md`.

## Need help?

- `CLAUDE.md` covers the code-quality, security, and testing standards you're expected to follow.
- `wiki/index.md` is the index of everything we've decided.
- Stuck? Open a draft PR with your question in the description — that's the fastest way to get unblocked.
