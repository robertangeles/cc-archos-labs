---
title: drizzle-kit push hangs on Render Postgres at "Pulling schema"
category: lessons-learned
created: 2026-05-08
updated: 2026-05-08
related: [[2026-05-08-render-postgres-over-neon]], [[2026-05-08-minimal-admin-for-seo]]
---

## Problem

`drizzle-kit push` (drizzle-kit ^0.31.10) hangs indefinitely at the "Pulling schema from database..." step when run against Render Postgres (PostgreSQL 18.3, Singapore region) — both with `ssl: 'require'` and `ssl: { rejectUnauthorized: false }` in `drizzle.config.ts`'s `dbCredentials`. Direct `postgres-js` connection to the same `DATABASE_URL` works fine for queries (verified via `scripts/test-db.mjs`). Same `drizzle-kit generate` succeeds because it doesn't connect.

## Fix

Bypass `drizzle-kit push`. Use `drizzle-kit generate` to produce SQL migration files, then apply them directly via a `postgres-js` script that connects exactly the way `lib/db/index.ts` does. Tracks applied migrations in a `__drizzle_applied` metadata table for idempotency.

```
pnpm db:generate   # drizzle-kit generate (no DB connection)
pnpm db:migrate    # node scripts/db-apply.mjs (applies SQL via postgres-js)
```

Both scripts live in `package.json`. The applier is at `scripts/db-apply.mjs`.

## Rule

When working with Drizzle on a managed Postgres (Render, Supabase, Neon, etc.), don't trust `drizzle-kit push` for the runtime path — generate SQL with `drizzle-kit generate` and apply it through a connection you control. Avoids opaque hangs in unfamiliar networking + driver combinations and keeps the migration apply-step in your own runtime.
