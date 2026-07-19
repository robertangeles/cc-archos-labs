---
title: Brain PROD cutover — flip to in-app pgvector + distillation
category: runbook
created: 2026-07-19
updated: 2026-07-19
related: [[2026-07-16-brain-inapp-pgvector-migration]], [[2026-07-19-brain-distillation-layer]], [[deployment-architecture]]
---

How to switch PROD from the external GBrain service to the in-app pgvector brain + distillation, with the least friction and an instant rollback. The code is already on PROD (merged #187 + #188 → Render auto-deployed); this is **data + one env var**, not a deploy.

## Pre-flight

- [ ] You have the Render **External Database URL** for PROD. Export it (never `.env.local`, which is DEV):
      `export PROD_DATABASE_URL="postgres://…singapore-postgres.render.com/…?sslmode=require"`
- [ ] `pg_dump` on your machine is ≥ the Render Postgres version (else the script's backup step aborts — take a Render dashboard backup instead).
- [ ] Decide: **backfill or start fresh** (below).

## Decision — backfill existing GBrain memories, or start fresh?

- **Start fresh (recommended, least friction):** skip the backfill. Users re-accumulate memory as they chat. GBrain has been cold-start-flaky, so there's likely little durable memory to preserve.
- **Migrate:** run the backfill after the cutover script (step 2 below) so no one starts empty.

## Steps

### 1. Run the cutover script (backup + migrations + prompt)

Dry-run first (writes nothing, prints the plan):
```bash
PROD_DATABASE_URL="…" node scripts/brain-prod-cutover.mjs
```
Then apply:
```bash
PROD_DATABASE_URL="…" node scripts/brain-prod-cutover.mjs --apply
```
This takes a `pg_dump` backup FIRST (aborts before any write if it fails), applies migrations `0032` + `0033` via the proven `db-apply.mjs`, and applies the `brain-memory-v1` prompt clause (idempotent; handles the legacy jsonb double-encoding — writes a single-encoded object so `getChatPrompt` reads it). It does **not** flip the flag or backfill.

### 2. (Optional) Backfill GBrain memories → facts

Only if you chose "migrate". Dry-run then apply:
```bash
DATABASE_URL="$PROD_DATABASE_URL" node --conditions=react-server --import tsx scripts/backfill-brain-to-pgvector.ts
DATABASE_URL="$PROD_DATABASE_URL" node --conditions=react-server --import tsx scripts/backfill-brain-to-pgvector.ts --apply
```
Idempotent (skips users who already have rows). Re-distills each GBrain page into clean facts.

### 3. Flip the flag (the final gate)

Render → the web service → **Environment** → set `MEMORY_BACKEND=pgvector` → save. The service restarts (~2-4 min).

### 4. Smoke test (on archoslabs.xyz)

- [ ] Tell Metis to remember a fact → `/account/brain` shows a **clean single-line fact** (not a `## User` dump).
- [ ] New conversation → "what do you know about me?" → it recalls.
- [ ] Metis speaks in the full persona (not the generic placeholder) — confirms the prompt is correctly encoded.

## Rollback (instant)

Unset `MEMORY_BACKEND` on Render → save. Back on GBrain immediately. This works because the GBrain code is still wired — that's why we kept it.

## Post-soak cleanup (separate PR, later)

After pgvector runs clean in PROD for a stretch:
- Remove `lib/brain/{client,provision,warm}.ts` (+tests) and the `provision`/`warm` routes.
- Drop the `user_brain` table.
- Remove `MEMORY_BACKEND`/`BRAIN_EXTRACTION_MODEL` branches (make pgvector unconditional).
- Decommission the GBrain Render service + Supabase, after a final export of its data.

## Gotcha (fixed, recorded so it doesn't recur)

`site_setting.value` can be stored **double-encoded** (a jsonb string wrapping the object). Writing a prompt with `JSON.stringify(obj)::jsonb` double-encodes it, and `getChatPrompt` then silently falls back to the placeholder prompt. Always write with `sql.json(obj)` (or Drizzle `.values({ value: obj })`) and read defensively (`JSON.parse` if the value comes back a string). The cutover script does both.
