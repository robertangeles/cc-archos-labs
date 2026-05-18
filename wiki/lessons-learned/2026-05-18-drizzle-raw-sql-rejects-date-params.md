---
title: Drizzle raw `sql` template rejects Date bind parameters (postgres.js driver)
category: lessons-learned
created: 2026-05-18
updated: 2026-05-18
related: [[2026-05-18-data-retention-policy]], [[2026-05-08-render-postgres-over-neon]]
---

## Problem

The first daily run of `/api/cron/purge-session-metadata` returned 500 in production. The Render web service logs showed:

```
TypeError: The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date
    at Function.str (.next/server/chunks/_0f1y8vd._.js:1:67087)
  code: 'ERR_INVALID_ARG_TYPE'
```

The failing query was an UPDATE built with Drizzle's raw `sql` template tag, with two `Date` objects interpolated as bind parameters:

```ts
await db.execute(sql`
  UPDATE ${assessmentSession}
  SET ip_address = NULL, user_agent = NULL, updated_at = ${now}
  WHERE created_at < ${cutoff}
`);
```

Unit tests passed locally — they mock `getDb` and never exercise the real postgres.js driver. So the bug only surfaced when the cron fired against production.

## Fix

Rewrite the query using Drizzle's **typed query builder** instead of the raw `sql` template:

```ts
await db
  .update(assessmentSession)
  .set({ ipAddress: null, userAgent: null, updatedAt: now })
  .where(
    and(
      or(isNotNull(assessmentSession.ipAddress), isNotNull(assessmentSession.userAgent)),
      lt(assessmentSession.createdAt, cutoff),
    ),
  )
  .returning({ id: assessmentSession.id });
```

The typed builder serialises `Date` columns through Drizzle's type system before binding. The raw `sql` template hands the value straight to postgres.js, which calls `.str()` on it and rejects non-string/Buffer arguments.

Same fix applied to the lead purge — `notExists(tx.select()...)` for the subqueries, `inArray()` for the bulk delete, `.returning()` for row counts.

## Rule

- **Default to Drizzle's typed query builder** (`db.update().set().where()`, `db.select().from().where()`, `db.delete().where()`) whenever the operation is expressible that way. Treat the raw `sql` template as an escape hatch for things the typed builder can't express (CTEs, window functions, dialect-specific extensions).
- **If you must use the raw `sql` template with a `Date`**, convert it to an ISO string first (`${now.toISOString()}::timestamptz`) so postgres.js never sees a `Date` object.
- **Unit-mocking `getDb` does not exercise the driver.** A unit test that passes proves the function's shape, not that the SQL will execute. For any new lib that issues DB writes, the regression-testing protocol in CLAUDE.md §6 ("Integration tests for API routes with real database") is what catches this class of bug — the unit suite is necessary but not sufficient.
