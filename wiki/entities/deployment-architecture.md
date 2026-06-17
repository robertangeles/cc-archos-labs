---
title: Deployment architecture
category: entity
created: 2026-05-20
updated: 2026-06-17
related: [[2026-05-08-render-postgres-over-neon]], [[integration-config]], [[index]], [[state]]
---

The runtime topology of Archos Labs.

> **⚠️ CURRENT REALITY (since 2026-06-15): TWO databases, not one.**
> `.env.local`'s `DATABASE_URL` points at a **local DEV Postgres** (`archos_labs_dev`, host `127.0.0.1`, PG18, no SSL). **PROD** is the Render `archos_labs_pdb` (Singapore), kept commented in `.env.local` as `DATABASE_URL_RENDER_PROD`. **They are separate.** Anything you run locally via `.env.local` (`db:migrate`, seeds, ad-hoc SQL) hits **DEV only**; PROD must be migrated separately (see the 2026-06-15 section below). Before claiming where data lives, **check the `DATABASE_URL` host** — a `127.0.0.1` / no-SSL connection is DEV, period. The original "single database" framing below (created 2026-05-20) is **historical** — kept for the deploy/web-service topology, but the data layer is no longer single-DB.

## The shape

```
┌────────────────────────────────────────────────────────────────────┐
│  Render web service                                                │
│  ─────────────────────                                             │
│  - Auto-deploys on every push to `main`                            │
│  - Next.js 16 / App Router                                         │
│  - Reads DATABASE_URL from Render env (set in dashboard)           │
│  - Serves archoslabs.xyz                                           │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
                          ▼  (same connection string both ways)
┌────────────────────────────────────────────────────────────────────┐
│  Render Postgres — archos_labs_pdb                                 │
│  ──────────────────────────────────                                │
│  Host: dpg-d7u1upd0lvsc73ekq010-a.singapore-postgres.render.com    │
│  Region: Singapore                                                 │
│  pgvector + HNSW indexes for /blog read-next + /search             │
│  All site_setting rows (blog_enabled, integration_secrets,         │
│  site, diagnostic_content, diagnostic_prompt, booking_prompts)     │
└────────────────────────────────────────────────────────────────────┘
                          ▲
                          │  (same connection string both ways)
┌─────────────────────────┴──────────────────────────────────────────┐
│  Local dev (Rob's machine)                                         │
│  ──────────────────────────                                        │
│  - `.env.local` DATABASE_URL points at the SAME Render Postgres    │
│  - `pnpm dev` reads + writes the same rows the prod web service    │
│    reads + writes                                                  │
└────────────────────────────────────────────────────────────────────┘
```

`.env.local` and Render's environment configuration point at the **same** Render Postgres connection string. Local migrations, local seed scripts, local `pnpm db:studio` — all read and write production data directly. There is no staging schema, no separate database, no preview branches.

## What this means for tooling

- **Migrations** run from `pnpm db:migrate` are immediately live. There is no "dev → prod migration step". The first run is the only run.
- **`scripts/migrate-wp/`** writes to the same Postgres the web service serves from. The May 2026 WP migration of 253 posts ran from Rob's laptop and lit up the prod /blog the moment it completed.
- **`scripts/seed/*`** scripts target prod by definition. The `blog-author-backfill` script writes the author byline that the prod /blog renders.
- **Schema changes** ship through normal PR flow: PR merges → Render redeploys → first request hits the new code, which reads/writes the same DB. There is no separate `drizzle-kit push --target=prod` step.
- **Feature flags** (e.g. `site_setting.blog_enabled`) are the only mechanism for shipping code-but-hiding-feature. A new public surface lands code-merged-flag-off, and a single SQL UPDATE or admin toggle flips it on.

## What this means for sessions

When the user mentions deployment, migration, staging, prod cutover, environment promotion, or "running against prod" — **stop and re-read this page** before suggesting a runbook. The conventional pattern is two or three environments; this project has one. Solutions like `PROD_DATABASE_URL` shell-env-override safety gates are solving an imaginary problem and add noise to the codebase.

When the user says something architectural that doesn't fit the conventional multi-env mental model (e.g. "Database URL is in our settings", "DEV and PROD DB are the same"), accept it at face value. Don't reinterpret it through a conventional lens.

## 2026-06-15 — temporary local DEV clone for the org migration

For the org/clients/projects/kanban migration (a large additive schema change — see [[org-consulting-workspace]]) a **local DEV Postgres** (`archos_labs_dev`, PG18) was created as a clone of PROD, and `.env.local` was repointed at it. This is exactly the "separate DB for a schema change that warrants a rehearsal" case anticipated above — not a permanent move to multi-env.

- **DEV** (local `archos_labs_dev`): migrations `0025` + `0026` applied + default-org backfill + session test data. `.env.local` → DEV.
- **PROD** (Render `archos_labs_pdb`, Singapore): migrated 2026-06-15 — `0025` + `0026` applied (after a `pg_dump` backup) + the 9 pre-existing users backfilled a default org each (schema-only migration does not backfill; `createDefaultOrgForUser` runs only at registration). The Render URL is kept commented in `.env.local` as `DATABASE_URL_RENDER_PROD`.

The org migration to PROD was a **manual** run of the idempotent `scripts/db-apply.mjs` against the PROD URL (there is no migrate-on-deploy hook; `build`/`start` are vanilla), plus a one-time existing-user org backfill. Schema is now in sync DEV↔PROD; DEV's test data is not (and must not be) copied to PROD. The single-DB posture above remains the intended steady state once the rehearsal DB is retired. **Backup:** `~/archos_prod_backup_20260615-210817.dump` (pg_restore custom format).

## Other services on the same posture

| Service | Instance count | Notes |
|---|---|---|
| Cloudflare R2 (`archos-labs-blog-media`) | 1 bucket | Shared by local dev + Render runtime. Public URL serves the same objects to both. |
| Resend | 1 account | Single API key in `integration_secrets`. Local-dev sends real email if the key resolves. |
| OpenRouter | 1 account | Single API key. Drives Claude polish + OpenAI embeddings + diagnostic generation. |
| Google Calendar OAuth | 1 client | Redirect URI is the only env-specific value (localhost vs prod URL). |
| Cloudflare Turnstile | 1 site key + 1 secret | Single environment binding. |

The integration-secrets pattern ([[integration-config]]) stores all of the above in `site_setting.integration_secrets` (AES-GCM-encrypted at rest with the env-rooted master key). That row is part of the same single DB — there is no separate "prod secrets vault" to reach for.

## Why the project is wired this way

Pre-launch posture for a solo operator with an 11-day revenue deadline (May 2026 — consulting is the only immediate revenue path): one environment, one DB, ship credibly fast, harden later. The single-env decision was implicit in the bootstrap — there is no decision doc framing it because no alternative was ever considered. This wiki page is the after-the-fact record.

If/when the project ever needs a staging environment (scale: a second contributor, or a destructive schema change that warrants a rehearsal), the right move is a separate Render Postgres + a `PROD_DATABASE_URL` pattern. **Until that moment, don't pre-build for it.**

## Operational runbooks

### Render Cron jobs

Three cron jobs are configured in the Render dashboard (not in repo — there is no `render.yaml`). All POST to authenticated endpoints with `Authorization: Bearer ${CRON_SECRET}` (single secret shared across cron + runtime).

| Cron | Schedule | Endpoint | Purpose | Heartbeat row id |
|---|---|---|---|---|
| `process-scheduled` | every minute | `POST /api/cron/process-scheduled` | Drains the `scheduled_job` queue (booking reminders, pre-call briefs, post-call follow-ups, no-show recovery) | `singleton` |
| `process-scheduled-posts` | every minute | `POST /api/cron/process-scheduled-posts` | Flips `post.status='scheduled' AND scheduled_publish_at <= now()` rows to `published`. Writes a `post_revision` row tagged `savedBy='scheduler-cron'` per publish. | `posts-publisher` |
| `process-scheduled-social` | every minute | `POST /api/cron/process-scheduled-social` | Dequeues `scheduled_social_post` rows where `status='pending' AND scheduled_for <= now()`, publishes to connected social platforms (Twitter, LinkedIn, Bluesky). Max 3 retry attempts per post. | `social-publisher` |

If `CRON_SECRET` is missing / shorter than 16 chars, all three routes return 503 (cron not configured) BEFORE checking the bearer. Same behaviour locally + in prod — local dev rarely needs the cron running.

### Render cron job configuration (exact settings)

All three cron jobs use identical Render configuration. **Copy this exactly when adding a new cron:**

| Setting | Value |
|---|---|
| Source | Git Provider — `robertangeles/cc-archos-labs`, branch `main` |
| Language | Node |
| Region | Singapore (Southeast Asia) — same as database |
| Instance Type | Starter (0.5 CPU, 512 MB) |
| Schedule | `* * * * *` (every minute) |
| Build Command | `true` |
| Command | `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://archoslabs.xyz/api/cron/<endpoint-name>` |
| Auto-Deploy | On Commit |
| Env vars | `CRON_SECRET` — same value as the web service |

**Do NOT use Docker images for cron jobs.** The Git Provider approach runs in a proper shell where `$CRON_SECRET` is expanded correctly. Docker exec form does not expand environment variables.

When adding a new cron, also copy the auth + heartbeat pattern from `app/api/cron/process-scheduled-posts/route.ts`; each cron should write to its own `cron_heartbeat` row id so monitoring can distinguish per-cron health.

### Post-deploy verification (MANDATORY)

After merging any PR that adds a new cron endpoint, verify:
1. The Render web service deploy completed successfully (check Events tab)
2. The new cron job is created in Render dashboard with the settings above
3. The cron heartbeat row appears in `cron_heartbeat` after the first run
4. Hit the endpoint manually to confirm it returns 200 (not 404 or 503)

## Related

- [[2026-05-08-render-postgres-over-neon]] — why Render Postgres in the first place
- [[integration-config]] — the shared secrets-at-rest store sitting in this single DB
- [[state]] — auto-generated register of what's actually shipped (always read this first)
- [[2026-05-20-posts-admin-phase-d-backend]] — the second cron (`process-scheduled-posts`) shipped here
