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

## Workflow

`main` is protected. You cannot push directly. Every change goes through a PR.

```bash
git checkout main && git pull
git checkout -b feature/short-descriptive-name
# ... work ...
git commit -m "Verb noun: brief detail"
git push -u origin feature/short-descriptive-name
gh pr create   # or open in the GitHub UI
```

Then:

1. CI runs automatically on the PR (lint + typecheck + test + build).
2. Wait for green.
3. Request review from Rob (CODEOWNERS does this automatically).
4. Address feedback by pushing more commits to the branch.
5. Once approved + CI green, **squash-merge** the PR (linear history is enforced).
6. Delete your branch.

Keep branches short-lived. If a branch is open more than two days, something is probably wrong with the scope.

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
