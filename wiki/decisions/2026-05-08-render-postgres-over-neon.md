---
title: Render Postgres over Neon for database hosting
category: decision
created: 2026-05-08
updated: 2026-05-08
related: [[2026-05-08-phase2-ceo-review]], [[backlog]], [[index]]
---

Switched the project's Postgres host from Neon to Render Postgres for single-provider operational simplicity at deploy-setup time.

## Decision

Use **Render Postgres** as the project's PostgreSQL host instead of Neon. Web service and database both run on Render, managed from a single dashboard, billed under one account, monitored together. Drizzle ORM stays — it's portable across Postgres providers.

## Why

- **Single-provider operational surface.** One vendor, one billing account, one set of credentials, one observability dashboard. For a solo founder shipping urgently against a revenue deadline, fewer moving parts is the right tradeoff.
- **Same control plane as the web service.** Web ↔ DB latency is intra-region; service-to-DB networking can use Render's internal hostname instead of a public connection string.
- **No extra account to manage.** Neon would mean a separate vendor relationship to provision, secure, and pay for.

## What we're trading away

- **Neon's serverless model** scales to zero when idle and re-warms on demand. Render Postgres is a long-running container — no idle savings, but no cold-start latency either.
- **Free tier on Render Postgres expires after 90 days.** Neon's free tier is indefinite. Production-grade Render Postgres requires a paid plan well before the 90-day window closes (set a reminder).
- **No native database branching.** Neon's killer feature for preview environments is per-branch DBs; Render Postgres has no native equivalent. Phase 2 development uses a separate dev DB or a schema namespace pattern instead of per-PR branches.
- **Project-standards deviation.** CLAUDE.md and [[2026-05-08-phase2-ceo-review]] originally documented Neon as the DB choice; both are updated this session to reflect Render Postgres.

## Trigger to revisit

If Render Postgres hits performance, reliability, or cost-at-scale issues — or if the lack of branching becomes a real friction point during Phase 2 — reassess. Drizzle ORM is portable; migration to Neon (or another Postgres host) is `pg_dump` + reimport + `DATABASE_URL` swap.
