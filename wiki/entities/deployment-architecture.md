---
title: Deployment architecture
category: entity
created: 2026-05-20
updated: 2026-05-20
related: [[render-postgres-over-neon]], [[integration-config]], [[index]], [[state]]
---

The runtime topology of Archos Labs. **Single environment, single database** — there is no dev / staging / prod separation at the data layer. This is unusual relative to industry convention; documenting it explicitly so future sessions don't assume a multi-env setup and build elaborate machinery to bridge it.

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

Pre-launch posture for a solo operator with an 11-day revenue deadline ([[project-revenue-deadline]]): one environment, one DB, ship credibly fast, harden later. The single-env decision was implicit in the bootstrap — there is no decision doc framing it because no alternative was ever considered. This wiki page is the after-the-fact record.

If/when the project ever needs a staging environment (scale: a second contributor, or a destructive schema change that warrants a rehearsal), the right move is a separate Render Postgres + a `PROD_DATABASE_URL` pattern. **Until that moment, don't pre-build for it.**

## Related

- [[render-postgres-over-neon]] — why Render Postgres in the first place
- [[integration-config]] — the shared secrets-at-rest store sitting in this single DB
- [[state]] — auto-generated register of what's actually shipped (always read this first)
