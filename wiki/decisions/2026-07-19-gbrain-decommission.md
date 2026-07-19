---
title: GBrain fully decommissioned — service deleted, code removed, table dropped
category: decision
created: 2026-07-19
updated: 2026-07-19
related: [[2026-07-16-brain-inapp-pgvector-migration]], [[2026-07-19-brain-distillation-layer]], [[deployment-architecture]], [[brain-prod-cutover]], [[conversational-memory-design]], [[2026-06-10-gbrain-multi-user-integration]]
---

The external GBrain Render service and all supporting code have been removed. In-app pgvector is now the sole memory backend — unconditional, no flag.

## What happened (2026-07-19)

1. **PROD cut over.** Migrations `0032` + `0033` applied to PROD via `scripts/brain-prod-cutover.mjs --apply` (backup first). The `brain-memory-v1` system-prompt clause applied. `MEMORY_BACKEND=pgvector` set on the Render `cc-archos-labs` web service. Deploy went live 2026-07-19. See [[brain-prod-cutover]] for the step-by-step.

2. **GBrain Render service deleted.** `cc-archos-labs-gbrain.onrender.com` no longer exists. The Render dashboard service `cc-archos-labs-gbrain` was deleted.

3. **Code removed** (branch `chore/remove-gbrain-backend`):
   - `lib/brain/client.ts`, `lib/brain/provision.ts`, `lib/brain/warm.ts` + their tests
   - `app/api/brain/provision/route.ts`, `app/api/brain/warm/route.ts`
   - `MEMORY_BACKEND` env flag removed: `lib/brain/recall.ts` and `lib/brain/extract.ts` no longer branch — pgvector is unconditional
   - `gbrainUrl` + `gbrainAdminToken` fields removed from `lib/integration-config-shared.ts` and the admin panel
   - `user_brain` table removed from `lib/db/schema.ts`

4. **Schema migration `0034` (`drizzle/0034_drop_user_brain.sql`)** DROPs the `user_brain` table. Applied to DEV and PROD separately, PROD with a `pg_dump` backup first.

## What was NOT migrated / cleaned up (future work)

- **GBrain Supabase DB** — still exists, holds old per-user memories from the external service. Decision: start fresh (no backfill). Not reachable from the app. Can be deleted whenever.
- **GitHub fork** — `robertangeles/cc-archos-labs-gbrain` still exists. Can be archived or deleted.
- **`scripts/brain-prod-cutover.mjs`** and **`wiki/runbooks/brain-prod-cutover.md`** — spent/historical. The cutover is complete. The runbook is marked COMPLETED at the top; do not delete it (post-mortem reference).

## Architecture after decommission

```
Render web service (cc-archos-labs)
    |
    +-- Render Postgres (archos_labs_pdb)
    |     user_memory      ← pgvector: per-user atomic facts (migration 0032)
    |     memory_fact       ← distillation layer: dedup + supersede (migration 0033)
    |
    [NO external GBrain service]
```

`lib/brain/recall.ts` and `lib/brain/extract.ts` call pgvector directly. No HTTP hop, no cold-start risk, no OAuth per-user provisioning.

## Why this is better

The original two-service design was a technical constraint (GBrain needed Postgres admin settings Render didn't expose). Once pgvector support landed on Render Postgres, the external service became pure overhead: extra cold-start latency, per-user OAuth dance, and a Supabase DB to maintain. The in-app path is faster, simpler, and under one deployment surface.
