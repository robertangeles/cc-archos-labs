---
title: Don't assume multi-environment architecture — read [[deployment-architecture]] first
category: lessons-learned
created: 2026-05-20
updated: 2026-05-20
related: [[deployment-architecture]], [[2026-05-20-phase-c-cutover]], [[2026-05-19-translation-layer-migration]]
---

## Problem

During the Translation Layer migration (rosy-bee), the assistant framed Phase C as a "prod cutover" requiring:

- A `PROD_DATABASE_URL` shell-env override pattern
- Double-flag safety gate (`--prod` + `--confirm-prod`) on both `migrate-wp:apply` and `seed:blog-author`
- Refusal to run if `PROD_DATABASE_URL === DATABASE_URL` (defending against operator misconfiguration)
- A `TARGET: PRODUCTION DB (host)` banner before any writes
- A 10-step runbook with PowerShell + bash forms for grabbing the URL from Render's dashboard, exporting it in a fresh shell, running the migration, unsetting after, clearing shell history

All of that scaffolding (PR #65) assumed a separate prod database that doesn't exist. Archos Labs has **one** Render Postgres — `.env.local` and Render's env both point at the same connection string. The pilot migration on 2026-05-19 wrote directly to prod; the author byline backfill wrote directly to prod; the `blog_enabled` flag was flipped on directly in prod. By the time the Phase C PR was even drafted, /blog had been live on archoslabs.xyz for hours.

The root cause was assuming industry convention (dev / staging / prod) when the project follows none. Three signals from the user — "Database URL is in our settings", "Database URL is in the DB where you already have access to it", "DEV and PROD DB are the same" — each got reinterpreted through the assumed-multi-env lens before the assistant accepted that the architecture itself was different.

PR #66 stripped the entire prod-target plumbing back to single-DB reality. Net diff: **+57 / -320 lines**, plus an extra round of frustration with the user.

## Fix

**Read `wiki/entities/deployment-architecture.md` at the start of any session that involves the words "migration", "deploy", "environment", "staging", "prod cutover", "promote", or "release."** That page explicitly states the project is a single-environment, single-database setup. If the page disagrees with the assistant's assumed architecture, the page is right and the assumption is wrong.

When the user contradicts the assistant's mental model with an architectural statement (e.g. "DEV and PROD DB are the same", "we don't have staging", "X is already deployed"), treat that statement as the architecture rewriting itself. Do NOT try to fit the user's words into the existing assumed pattern. Do NOT escalate to defensive scaffolding that "supports" the conventional pattern. Stop, ask "tell me about the deployment topology", and update the mental model.

## Rule

**When the user pushes back on a runbook or contradicts the assistant's architectural assumption, the assumption is wrong, not the user.** Conventional patterns from training data (dev/staging/prod, blue-green deploys, immutable releases, multi-region failover) are not defaults — they are choices a project made or didn't. Always verify against [[deployment-architecture]] and [[state]] before suggesting any operational runbook.

Specific tells that the assistant is about to drift into imaginary-architecture territory:

- Recommending `PROD_*` env vars when the project has no such convention elsewhere
- Suggesting "cutover" or "promotion" steps without a documented decision establishing the separation those steps would cross
- Writing safety scaffolding for "accidentally targeting prod" when the project structure makes such an accident impossible
- Proposing a runbook that touches more than one of: shell env vars, dashboards, DNS, registry settings — that's a smell that the runbook is bridging gaps that may not exist

Three sanity checks before writing any operational runbook:

1. **Is there a wiki entity for the deployment architecture?** Read it.
2. **Has the user mentioned anything that contradicts the assumed setup?** Believe them.
3. **What's the minimum operation that achieves the user's outcome on the current architecture?** Start there. Add safety only when an actual asymmetry justifies it.

Related: [[deployment-architecture]] documents the actual architecture. [[2026-05-20-phase-c-cutover]] is the post-mortem of the specific failure that prompted this rule.
