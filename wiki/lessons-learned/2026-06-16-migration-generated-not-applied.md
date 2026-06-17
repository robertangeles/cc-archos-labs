---
title: Clean build + passing tests can still 500 — the migration was never applied
category: lessons-learned
created: 2026-06-16
updated: 2026-06-16
related: [[2026-06-11-drizzle-push-vs-migrate]], [[2026-05-20-single-db-architecture]], [[deployment-architecture]]
---

A feature can have schema, a committed migration file, passing tests, and a clean `pnpm build` — and still throw a 500 at runtime because the migration was never applied to the live database.

## Problem

`/workspace/model-studio` threw a server error on load. The `data_model` table was defined in `lib/db/schema.ts`, the migration `drizzle/0027_model_studio_data_model.sql` existed and was recorded in `drizzle/meta/_journal.json`, the API routes and 29 tests existed, and `pnpm build` was clean. Everything that lives in the repo was correct.

But `to_regclass('public.data_model')` returned `null` — the table did not exist in the database. The migration file had been generated and committed, but `pnpm db:migrate` was never run, so the single shared Postgres was out of sync with the schema. Authenticated requests to `/api/model-studio` queried a non-existent table and threw.

The misleading part: tests passed because they mock the DB layer, and `pnpm build` only type-checks and compiles — neither touches the live database. The journal (`_journal.json`) tracks what `db:generate` produced, NOT what was applied; the `__drizzle_applied` table is the only record of what actually ran.

## Fix

`pnpm db:migrate` — it applied only the pending `0027` (all prior migrations were SKIP'd as already in `__drizzle_applied`). The migration is idempotent (`CREATE TABLE IF NOT EXISTS`, guarded constraints), and purely additive, so applying it against the shared DB carried no data risk. Verified: table now resolves with 14 columns and 4 indexes; list query returns cleanly.

## Rule

- "Build is clean and routes exist but the page 500s" → suspect an unapplied migration BEFORE anything else. Check `to_regclass('public.<table>')`, not the journal.
- A migration in `drizzle/` + `_journal.json` is NOT proof it was applied. `__drizzle_applied` (or `to_regclass`) is the source of truth for live DB state.
- After generating a migration, you MUST run `pnpm db:migrate`. Generating and committing the SQL file is only half the change.
- Tests and `pnpm build` do not touch the live DB — they cannot catch a missing-table 500. Only a real query (or an authenticated request) will.
