---
title: Deployment architecture
category: entity
created: 2026-05-20
updated: 2026-07-27
related: [[2026-05-08-render-postgres-over-neon]], [[integration-config]], [[index]], [[state]], [[chat-attach-files]], [[2026-07-19-gbrain-decommission]], [[2026-07-27-dev-db-is-per-machine]]
---

The runtime topology of Archos Labs.

> **⚠️ CURRENT REALITY (since 2026-06-15): TWO databases, not one.**
> `.env.local`'s `DATABASE_URL` points at a **local DEV Postgres** (`archos_labs_dev`, host `127.0.0.1`, PG18, no SSL). **PROD** is the Render `archos_labs_pdb` (Singapore), kept commented in `.env.local` as `DATABASE_URL_RENDER_PROD`. **They are separate.** Anything you run locally via `.env.local` (`db:migrate`, seeds, ad-hoc SQL) hits **DEV only**; PROD must be migrated separately (see the 2026-06-15 section below). Before claiming where data lives, **check the `DATABASE_URL` host** — a `127.0.0.1` / no-SSL connection is DEV, period. The original "single database" framing below (created 2026-05-20) is **historical** — kept for the deploy/web-service topology, but the data layer is no longer single-DB.
>
> **DEV is per-machine and is NOT guaranteed to exist.** `DATABASE_URL` naming a local host tells you which *role* the connection plays, not that the database is there. Each dev machine must have `archos_labs_dev` provisioned separately — see the 2026-07-27 section for the sequence. Confirm it exists before diagnosing anything else; a missing DEV DB surfaces as `PostgresError: database "archos_labs_dev" does not exist` (code `3D000`), which is a provisioning gap, not an app bug. The `DEV_MACHINE` key in `.env.local` records which laptop the file is configured for.

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

> **The ASCII diagram above is the ORIGINAL single-DB topology (2026-05-20) and is kept only as history.** Since 2026-06-15 there are two databases — see the banner at the top and the corrected model below.

**Current model — two databases, told apart by which `DATABASE_URL` is in play:**

```
Render web service (prod)  ──DATABASE_URL (Render env)──▶  PROD  Render Postgres archos_labs_pdb
                                                                 host *.singapore-postgres.render.com · SSL

Local dev (pnpm dev)       ──DATABASE_URL (.env.local)──▶  DEV   local Postgres archos_labs_dev
                                                                 host 127.0.0.1 · PG18 · no SSL
                                                                 (PROD URL kept commented as DATABASE_URL_RENDER_PROD)
```

The Render runtime reads PROD; local `pnpm dev` reads DEV. The fastest way to know which one you are touching: **check the `DATABASE_URL` host — `127.0.0.1` / no-SSL is DEV, a `*.render.com` / SSL host is PROD.** Schema is kept in sync DEV↔PROD by hand; data is not — DEV test data and per-env secrets never copy to PROD. The web service, R2 bucket, Resend, OpenRouter, and OAuth clients remain **single-instance** (one each), so "single" still describes the service layer; it is only the **database** that is now two.

## What this means for tooling

- **Local `pnpm db:migrate` / `db:push` / seeds / ad-hoc SQL hit DEV only.** They read `.env.local` → `archos_labs_dev`. They do NOT touch production.
- **PROD is migrated by hand, one deliberate run per release:** `pg_dump` backup → `DATABASE_URL="<PROD>" node scripts/db-apply.mjs` (idempotent — applies every untracked migration in order). There is **no migrate-on-deploy hook**; `build`/`start` are vanilla. Merging a PR ships *code* to PROD but does NOT migrate PROD's *schema*.
- **PROD migration state, verified 2026-07-29 (read-only pre-flight):** `__drizzle_applied` runs through `0036_content_plan_item.sql`, i.e. PROD is in step with DEV. `0035_workspace_memory.sql` **is** applied — earlier wiki pages recorded `0031`-`0034` and `0036` but never mentioned `0035`, and that silence read as a gap during the PR #223 pre-flight. It was not one. **When you migrate PROD, record the migration number here**, so the next person does not have to re-derive it from a live connection.
- **PROD can silently lag the migration history.** Because migration is manual, PROD's `__drizzle_applied` may trail DEV (this bit us on 2026-06-29 — PROD sat at `0026` while the code assumed `0028`). **Always check `__drizzle_applied` on PROD before a `db-apply` run.**
- **`scripts/migrate-wp/`, `scripts/seed/*`, `db:studio`** all target whatever `DATABASE_URL` is set — DEV by default. Point them at PROD only with an explicit `DATABASE_URL="<PROD>"` override.
- **Feature flags** (`site_setting.*`) are the way to ship code-but-hide-feature; each DB carries its own flag values. Note: the `MEMORY_BACKEND` env flag was removed in the GBrain decommission (2026-07-19) — pgvector is now unconditional.

## What this means for sessions

When the user mentions deployment, migration, staging, prod cutover, or "running against prod" — **re-read this page first.** The model: two databases (DEV local, PROD Render), schema synced manually, `.env.local` = DEV. Before claiming where any data lives, check the `DATABASE_URL` host.

The `DATABASE_URL="<PROD>" scripts/db-apply.mjs` + `pg_dump`-first posture is the REAL, in-use PROD-migration path (see the dated log below) — not hypothetical. If the user says something architectural that doesn't fit your assumption (e.g. "DEV and PROD are separate now", "we migrate PROD by hand"), treat their statement as the architecture rewriting itself and update this page — don't reinterpret it through a conventional lens.

## 2026-06-15 — temporary local DEV clone for the org migration

For the org/clients/projects/kanban migration (a large additive schema change — see [[org-consulting-workspace]]) a **local DEV Postgres** (`archos_labs_dev`, PG18) was created as a clone of PROD, and `.env.local` was repointed at it. Framed at the time as a temporary rehearsal, it **became the standing operating model**: every release since (0029–0031 below) migrates PROD separately by hand, and `.env.local` still points at DEV. The single-DB posture is retired — DEV/PROD are two databases now.

- **DEV** (local `archos_labs_dev`): migrations `0025` + `0026` applied + default-org backfill + session test data. `.env.local` → DEV.
- **PROD** (Render `archos_labs_pdb`, Singapore): migrated 2026-06-15 — `0025` + `0026` applied (after a `pg_dump` backup) + the 9 pre-existing users backfilled a default org each (schema-only migration does not backfill; `createDefaultOrgForUser` runs only at registration). The Render URL is kept commented in `.env.local` as `DATABASE_URL_RENDER_PROD`.

The org migration to PROD was a **manual** run of the idempotent `scripts/db-apply.mjs` against the PROD URL (there is no migrate-on-deploy hook; `build`/`start` are vanilla), plus a one-time existing-user org backfill. Schema is now in sync DEV↔PROD; DEV's test data is not (and must not be) copied to PROD. This manual DEV→PROD posture is now the standard for every release. **Backup:** `~/archos_prod_backup_20260615-210817.dump` (pg_restore custom format).

## 2026-06-29 — CDMP specialist: PROD migrated to 0030 + chapter backfill

Brought PROD up to migration `0030` and ran the DMBOK chapter backfill so the CDMP
specialist exams work for live users. Same manual posture as the org migration:
`pg_dump` backup → `DATABASE_URL="<PROD>" node scripts/db-apply.mjs` → `cdmp-chapter-tag.mjs`.

- **Pre-flight gotcha (worth remembering):** PROD's `__drizzle_applied` was at **0026**, not 0028 — migrations `0027` + `0028` (the Model Studio `data_model*` tables) had never been applied to PROD even though the feature code shipped. `db-apply.mjs` applies *all* untracked files in order, so the one run applied `0027`–`0030`. All four are idempotent (`CREATE … IF NOT EXISTS`, FK guards), and the FK target `project` already existed, so this was safe and also closed the latent Model Studio gap. **Lesson: the manual-migration model means PROD can silently lag the migration history — always check `__drizzle_applied` before assuming what a `db-apply` run will touch.**
- **CDMP schema:** `0029` (`knowledge_chunk.chapter` + index) and `0030` (`cdmp_exam_session.exam_type` default `'fundamentals'` NOT NULL, `specialist_area`, + index). 17 existing exam rows defaulted to `fundamentals` cleanly.
- **Backfill:** `scripts/cdmp-chapter-tag.mjs --apply` tagged **388/496** DMBOK chunks (108 null = front/back matter), supply identical to DEV (Ch3=24, Ch5=33, Ch8=28, Ch10=29, Ch11=33, Ch12=23, Ch13=43). The script's sanity gate passed (≥12 chapters, monotonic, all specialist ≥15, >200 tagged). Embeddings/content untouched → Fundamentals (semantic search over `category='dmbok'`, ignores `chapter`) is unaffected. Kimball "Data Warehouse Toolkit" chunks (also `category='dmbok'`) stayed NULL.
- **Smoke (live, authenticated):** generated a 20-question Data Quality specialist exam on production — Q1 came back tagged "Chapter 13 — Data Quality" with a well-formed 5-option SPC scenario. Supply cap worked (100-question option disabled; pool max = min(100, 43×2)=86). Fundamentals live-generation was NOT re-tested (additive-only change, embeddings untouched, DEV-verified) — low risk.
- **Backup:** `~/archos_prod_backup_20260629-182053.dump` (23 MB, custom format).
- DEV↔PROD schema in sync at 0030. Related: [[2026-06-02-cdmp-sequential-generation-slow]].

## 2026-07-07 — Attach Files: PROD migrated to 0031 + R2 chat integration

Brought PROD to migration `0031` for the chat Attach Files feature (see
[[chat-attach-files]]). Same manual posture: `pg_dump` backup →
`DATABASE_URL="<PROD>" node scripts/db-apply.mjs`.

- **Pre-flight:** PROD's `__drizzle_applied` was at `0030` (in sync with DEV), so the one run applied only `0031` — 2 new tables (`document`, `conversation_document`), 5 indexes, all `CREATE … IF NOT EXISTS` with inline FKs. Additive-only; touches nothing existing. (Unlike the 2026-06-29 CDMP run, PROD was NOT lagging this time — but the `__drizzle_applied` check was still run first per that lesson.)
- **Verified:** both tables present in PROD, 7 indexes, 12 columns on `document`.
- **R2 secrets are per-env — NOT migrated.** The new "Chat Documents (Cloudflare R2)" integration was configured **separately in the PROD admin panel**. Integration secrets live in `site_setting.integration_secrets`, AES-GCM-encrypted with the env-rooted master key, and are NOT copied DEV→PROD — **schema migrates, data (incl. secrets) does not.** Same private bucket (`archos-labs-chat-docs`) + bucket-scoped token as DEV; PROD "Test R2 storage" green. (This is the general rule, not a one-off: the whole point of the encrypted per-env store is that each environment is configured once.)
- **Backup:** `~/archos-prod-backup-before-0031-20260707-181056.dump` (23 MB, custom format).
- DEV↔PROD schema in sync at `0031`. Related: [[chat-attach-files]].

## 2026-07-19 — GBrain decommissioned; pgvector is now the sole memory backend

The external `cc-archos-labs-gbrain` Render service was **deleted**. Migrations `0032` + `0033` (`user_memory` pgvector table + distillation layer) were applied to PROD 2026-07-19 via `brain-prod-cutover.mjs --apply`. Migration `0034` (`DROP TABLE user_brain`) also applied to DEV and PROD (PROD with `pg_dump` backup first).

The cleanup PR (`chore/remove-gbrain-backend`) removed: `lib/brain/{client,provision,warm}.ts` + tests, the `/api/brain/provision` + `/api/brain/warm` routes, the `MEMORY_BACKEND` env flag (pgvector is now unconditional in `recall.ts`/`extract.ts`), the `gbrainUrl`/`gbrainAdminToken` integration-config fields + admin-panel inputs, and the `user_brain` table from the schema.

**Current memory topology:** `lib/brain/recall.ts` + `lib/brain/extract.ts` call `user_memory` (pgvector, Render Postgres) directly — no external HTTP hop, no cold-start dependency, no OAuth provisioning per user. `MEMORY_BACKEND` is no longer a recognised env var.

**Still external (not yet cleaned up):** the GBrain Supabase DB (old memories, start-fresh decision — no backfill); the GitHub fork `robertangeles/cc-archos-labs-gbrain`.

See [[2026-07-19-gbrain-decommission]] for the full decision record.

- **Pre-cutover backup:** standard `pg_dump` before `0032`/`0033`; separate `pg_dump` backup before `0034`.
- **DEV↔PROD schema in sync at `0034`.**

## 2026-07-27 — DEV Postgres provisioned on HEPHAESTUS from a PROD clone

The local DEV database had never been set up on this laptop. `.env.local` named `archos_labs_dev` and the `archos_dev` role existed and authenticated, but the database itself did not — so every local `db:migrate`, seed, and `pnpm dev` against it failed with `3D000`. The 2026-06-15 DEV clone was created on a different machine; nothing carried it here, and nothing in the repo recorded that DEV is per-machine.

**Provisioning sequence** (local PG 18.4, PROD PG 18.4 — same major, so a plain dump/restore is clean):

1. `sudo -u postgres psql -c "CREATE DATABASE archos_labs_dev OWNER archos_dev;"` — the `archos_dev` role has neither `CREATEDB` nor superuser, so this needs `postgres`.
2. `CREATE EXTENSION vector, pg_trgm, pgcrypto` **as superuser**, before restoring. `vector` is untrusted, so `archos_dev` cannot create it mid-restore.
3. `pg_dump "<PROD>" -Fc --no-owner --no-privileges` — PROD read-only throughout. 54 MB database → 26 MB dump.
4. `pg_restore --no-owner --no-privileges -d "<DEV>"` — no `--clean`, the target is empty.
5. Verify by row-count diff across every `public` base table.

**Expected restore errors — benign, exit code 1 is normal here.** Three `must be owner of extension` failures on `COMMENT ON EXTENSION` for `vector`, `pg_trgm`, `pgcrypto`. They occur because step 2 created the extensions as `postgres` while the restore runs as `archos_dev`. Only the comments are lost; the extensions work. **Anything touching `COPY`, a constraint, or a column type is NOT benign** — investigate before declaring success.

**Verified:** 118/118 tables identical, 5,490 rows, `__drizzle_applied` at 38 rows / `0036_content_plan_item.sql` — in sync with PROD and with the code.

**This also closed the `archos-paul-graham-essays` prompt drift** recorded in [[2026-07-26-verify-by-running-not-by-deploying]] (DEV 6,349 chars vs PROD 9,004). A full clone made the single-row sync unnecessary — DEV now reads 9,004 / md5 `eca95c3e30e6` / v5, carrying the `Pre-write check`, `Forbidden words`, and `SEO Package` sections it lacked.

**Accepted deviation:** a full clone copies `site_setting.integration_secrets` PROD→DEV, which [the per-environment secrets rule](#other-services-on-the-same-posture) says should not cross environments. Ciphertext only (AES-GCM, env-rooted master key), and the operator accepted the risk explicitly, including the production PII now resident on the laptop.

**Planned (week of 2026-08-03): a Render DEV Postgres**, so DEV stops being seeded from PROD by hand and stops being per-machine. When that lands, the `127.0.0.1` = DEV identity rule in the banner above **stops being true** and must be rewritten — DEV will be a `*.render.com` SSL host like PROD, and host alone will no longer distinguish them.

## Other services on the same posture

| Service | Instance count | Notes |
|---|---|---|
| Cloudflare R2 (`archos-labs-blog-media`) | 1 bucket | Shared by local dev + Render runtime. Public URL serves the same objects to both. |
| Resend | 1 account | Single API key in `integration_secrets`. Local-dev sends real email if the key resolves. |
| OpenRouter | 1 account | Single API key. Drives Claude polish + OpenAI embeddings + diagnostic generation. |
| Google Calendar OAuth | 1 client | Redirect URI is the only env-specific value (localhost vs prod URL). |
| Cloudflare Turnstile | 1 site key + 1 secret | Single environment binding. |

The integration-secrets pattern ([[integration-config]]) stores all of the above in `site_setting.integration_secrets` (AES-GCM-encrypted at rest with the env-rooted master key). **Each database has its own row** — secrets are configured per-environment and never copied DEV→PROD (schema migrates, data does not). DEV secrets ≠ PROD secrets; there is no shared "prod secrets vault."

## Why the project is wired this way

**At bootstrap (May 2026)** the posture was one environment, one DB: a solo operator with an 11-day revenue deadline, shipping credibly fast, hardening later. The single-env decision was implicit — no decision doc framed it because no alternative was considered.

**Since 2026-06-15** that changed. The org migration needed a rehearsal DB, so a local DEV Postgres was created and `.env.local` repointed at it — and the manual `pg_dump` → `db-apply.mjs` PROD path became the standing model for every release. So the project now runs exactly the "separate Render Postgres + explicit PROD `DATABASE_URL`" pattern that this section once said to defer. What is still *not* built (and still not needed): an automated migrate-on-deploy pipeline, preview branches, or a third staging tier. PROD migrations stay manual and deliberate, backup-first.

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
- [[integration-config]] — the per-environment secrets-at-rest store (each DB has its own `integration_secrets` row; secrets never copy DEV→PROD)
- [[state]] — auto-generated register of what's actually shipped (always read this first)
- [[2026-05-20-posts-admin-phase-d-backend]] — the second cron (`process-scheduled-posts`) shipped here
