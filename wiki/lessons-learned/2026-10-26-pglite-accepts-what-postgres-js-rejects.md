---
title: pglite passed a query that postgres-js rejects
category: synthesis
created: 2026-10-26
updated: 2026-10-26
related: [[news-radar]], [[2026-10-26-process-caches-live-on-globalthis]]
---

## Problem

The news radar's score write is a raw `sql` data-modifying statement. It passed every test (real Postgres semantics in pglite, mutation-checked) and was reviewed. The first real tick against the DEV database crashed on it: postgres-js cannot bind a JavaScript `Date` as an untyped parameter inside a raw `sql` fragment, and pglite can.

## Why

The unit tests used a different driver from production. The statement's SQL meaning was proven; the driver's parameter encoding was not. Reviewers read the code and could not see it either.

## Rule

Code with raw `sql` parameters gets one real run against the real driver before it ships: a script or a tick against DEV, not only pglite. In raw SQL pass dates as ISO text with a cast (`${d.toISOString()}::timestamptz`) and give every parameter a cast. The drizzle query builder maps Dates itself; this applies to `db.execute(sql...)` only. The radar's live DEV run (33 real feed items, real Jev, real embeddings) is how this was found, and the same run proved crash recovery: the 25 items claimed by the crashed tick were taken over by the next one.
