---
title: Local Dev Setup (bring-up on a fresh machine, e.g. ARCHOS)
category: entity
created: 2026-06-02
updated: 2026-06-02
related: [[2026-06-02-local-dev-auth-csrf-oauth-gotchas]], [[2026-06-02-puppeteer-postinstall-corrupt-zip-local]], [[2026-05-20-single-db-architecture]]
---

How to bring the Archos Labs app up for local development on a new machine. `.env.local` is gitignored, so a `git pull` does NOT bring it — recreate it per the recipe below.

## Architecture reminder

**Two databases** (since 2026-06-15): `.env.local` points at a **local DEV Postgres** (`archos_labs_dev`, `127.0.0.1`, PG18, no SSL); the Render runtime uses the separate **PROD** Render Postgres (`archos_labs_pdb`). Anything you run locally via `.env.local` (`db:migrate`, seeds, ad-hoc SQL) hits **DEV only** — it does NOT touch production. PROD is migrated separately by hand (`pg_dump` → `db-apply.mjs`). See [[deployment-architecture]].

## Steps

### 1. Clone + checkout

```bash
git clone <repo> && cd cc-archos-labs
git checkout feature/cdmp-practice-exam   # or main once merged
```

### 2. Install dependencies

```bash
pnpm install
```

If puppeteer's postinstall fails (`end of central directory record signature not found`), it's a flaky bundled download — see [[2026-06-02-puppeteer-postinstall-corrupt-zip-local]]:
```bash
rm -rf ~/.cache/puppeteer/chrome/mac-*
pnpm exec puppeteer browsers install chrome
pnpm install
```

### 3. Create `.env.local`

Start from the template, then fill it. **Only 3 secrets are bootstrap** — everything else (OpenRouter, Resend, Google OAuth, Turnstile) is read from the DB at runtime, decrypted with `BOOKING_ENCRYPTION_KEY`, so you do NOT paste those into env.

```bash
cp .env.example .env.local
```

`.env.local` should contain:

```
PORT=3007
NEXT_PUBLIC_SITE_URL=http://localhost:3007
TURNSTILE_ENABLED=false

# Pull these 3 from Render → service → Environment (DO NOT commit):
DATABASE_URL=<Render EXTERNAL database URL>
BOOKING_ENCRYPTION_KEY=<from Render>
AUTH_SECRET=<from Render>
```

Critical details (each one bit us on 2026-06-02):
- **`DATABASE_URL` must be the EXTERNAL Render URL** — host looks like `dpg-…-a.<region>-postgres.render.com` with `?sslmode=require`. The **Internal** URL (`dpg-…-a`, no domain) only resolves inside Render's network (NXDOMAIN off-network).
- **`NEXT_PUBLIC_SITE_URL=http://localhost:3007`** is required or auth POSTs 403 on the CSRF same-origin check ([[2026-06-02-local-dev-auth-csrf-oauth-gotchas]]).
- **`PORT` is mandatory** — the dev script hard-fails without it (CLAUDE.md bans defaulting to 3000).
- `TURNSTILE_ENABLED=false` skips CAPTCHA locally.

### 4. Run

```bash
pnpm dev   # http://localhost:3007
```

No migrate/seed/ingest needed if pointing at the shared prod DB — `cdmp_config`, the knowledge base (1 doc / 496 chunks), and `integration_secrets` are already present.

## Auth notes

- **Password login:** `trebor.selegna@outlook.com` has a password set (2026-06-02). Other accounts may be OAuth/magic-link only.
- **Google sign-in:** the OAuth client already has `http://localhost:3007/api/auth/google/callback` whitelisted (persists across machines on port 3007). If you change the port, add the matching redirect URI in Google Cloud Console.

## First task on a fresh box

Verify the CDMP generation perf fix end-to-end (it's tsc/unit-tested but never run live — [[2026-06-02-cdmp-sequential-generation-slow]]):
1. Log in at `/login`.
2. Start a **20-question** exam at `/tools/cdmp-practice`.
3. Confirm it generates in ~40s (not minutes) and that answer/complete return **200** (not 401).
