---
title: Never use drizzle-kit push — use pnpm db:migrate
category: lessons-learned
created: 2026-06-11
updated: 2026-06-11
related: [[deployment-architecture]], [[2026-05-20-single-db-architecture]]
---

Always use `pnpm db:migrate` (which runs `scripts/db-apply.mjs`), never `drizzle-kit push`.

## Problem

`drizzle-kit push` introspects the full database and tries to reconcile every table it finds against the Drizzle schema. Because Archos Labs shares a single Postgres instance with GBrain (40+ tables), push sees GBrain tables as "not in our schema" and generates DROP TABLE statements for all of them. The `tablesFilter` config option does not prevent this — it controls `generate`, not `push`.

Additionally, prior uses of `drizzle-kit push` did not write to the `__drizzle_applied` tracking table, causing `db:migrate` to try re-applying migrations that were already in the DB.

## Fix

1. `pnpm db:migrate` runs `scripts/db-apply.mjs` which reads migration SQL files from `drizzle/`, splits on `statement-breakpoint` markers, applies each statement, and tracks applied files in `__drizzle_applied`. It never introspects the database. It never drops tables.
2. After a `drizzle-kit push` has been used (which doesn't track), backfill the tracking table: `INSERT INTO __drizzle_applied (filename) VALUES ('filename.sql') ON CONFLICT DO NOTHING`.
3. Three migrations (0020-0022) were backfilled on 2026-06-11 after they were found to be applied-but-untracked.

## Rule

- `pnpm db:generate` to generate migration SQL from schema changes
- `pnpm db:migrate` to apply migrations — the ONLY way to apply schema changes
- NEVER run `pnpm db:push` or `drizzle-kit push` — it will try to drop GBrain tables
- If `db:migrate` fails with "relation already exists", the migration was applied via push but not tracked. Backfill `__drizzle_applied` and re-run.
