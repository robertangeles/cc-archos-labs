---
title: A DEV database is per-machine — a connection string is not proof it exists
category: synthesis
created: 2026-07-27
updated: 2026-07-27
related: [[deployment-architecture]], [[2026-07-26-verify-by-running-not-by-deploying]], [[blog-writer-agent-runbook]]
---

`.env.local` named a local DEV database, the wiki described it as the standing operating model, and the database had never been created on this laptop.

## Problem

A request to sync one drifted prompt row (`archos-paul-graham-essays`, DEV 6,349 chars vs PROD 9,004) could not start: connecting to DEV returned `PostgresError: database "archos_labs_dev" does not exist` (code `3D000`).

Three things had each looked like confirmation, and none of them were:

- **`.env.local` named the database.** `DATABASE_URL=postgresql://archos_dev:***@127.0.0.1:5432/archos_labs_dev`. A connection string is a statement of intent, not evidence of existence.
- **The role authenticated.** `archos_dev` existed on the cluster and its password worked — the connection reached the server and was rejected only at database selection. Partial setup reads exactly like complete setup until you name the database.
- **[[deployment-architecture]] described DEV as the standing model**, created 2026-06-15 and used for every release since. All true — on a *different* machine. The page never said DEV was per-machine, because when it was written there was only one machine.

The wasted motion came from a fourth thing: the operator said mid-investigation that DEV was on Render, then corrected it. Both the doc and the operator can be wrong about infrastructure at the same time, and neither is a substitute for querying the server.

## Fix

Provisioned `archos_labs_dev` on HEPHAESTUS as a full clone of PROD — `CREATE DATABASE` + extensions as superuser, `pg_dump -Fc` from PROD read-only, `pg_restore` into the empty local DB. Verified by a row-count diff over all 118 `public` tables: identical, 5,490 rows, `__drizzle_applied` at `0036`. Full sequence in [[deployment-architecture]] under 2026-07-27.

The drift that prompted the request disappeared as a side effect — a clone carries the correct prompt, so no single-row sync was written. **The narrow request was the wrong unit of work; the environment was.**

## Rule

**Before diagnosing anything against a database, confirm the database exists.** `SELECT datname FROM pg_database` costs one round trip and rules out a whole class of misdiagnosis. A `3D000` is a provisioning gap, not an app bug — do not go looking for a code fault behind it.

**Distinguish "which database does this connection mean" from "does that database exist."** The `127.0.0.1` = DEV rule in [[deployment-architecture]] answers only the first. Both questions need asking, and only the second one is answered by the server.

**Environment-shaped facts belong in the repo, not in one machine's state.** "DEV is a local clone" was true and recorded; "DEV must be provisioned per machine" was equally true and recorded nowhere, so the next machine rediscovered it by failing. When a setup step is done once by hand, write the sequence down the same day — the person who repeats it will not be the person who ran it.

**When a full rebuild is cheap, prefer it to surgical repair.** A 54 MB clone took minutes and fixed the prompt drift, the missing database, and the migration state together. Reach for the row-level fix only when the wholesale one is expensive or unsafe.

## Watch item

A Render DEV Postgres is planned for the week of 2026-08-03. When it lands, **the `127.0.0.1` = DEV identity rule stops working** — DEV becomes a `*.render.com` SSL host indistinguishable from PROD by host shape alone. That rule is quoted in `CLAUDE.md` as well as [[deployment-architecture]], and both must be rewritten in the same change that provisions the new database, or the guard against accidentally writing to PROD silently becomes useless.

**This is not hypothetical — the sibling Culinaire repo already runs a managed DEV Postgres, and its `/update-db` localhost guard has been silently refusing it.** Its two databases differ by a single suffix (`culinaire_kitchen_postgresdb_oqph` against `culinaire_kitchen_postgresdb`), which is the shape that turns one mistyped character into a restore over production.

The global `/update-db` (`~/.claude/commands/update-db.md`) was rewritten on 2026-07-27 to survive this: three checks that never yield to confirmation (URLs equal; host+database equal; **database name equal on any host**), then local proceeds while remote proceeds only after the operator names the target database back, re-confirmed every run. **A bare "yes" is not confirmation** — the failure being guarded against is a mistaken URL, and "yes" does not demonstrate the operator read it. Reuse that pattern for any guard that loses its cheap structural signal; when the machine can no longer verify a target, make the human demonstrate they checked rather than merely assent.
