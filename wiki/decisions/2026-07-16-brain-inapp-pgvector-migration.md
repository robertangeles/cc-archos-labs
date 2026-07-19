---
title: Brain migration — external GBrain → in-app pgvector
category: decision
created: 2026-07-16
updated: 2026-07-16
related: [[2026-06-10-gbrain-multi-user-integration]], [[2026-06-22-brain-recall-cold-start-timeout]], [[deployment-architecture]]
---

Metis per-user memory moved off the external GBrain Render service onto an in-app `user_memory` pgvector table, reusing the embedding + pgvector infrastructure already running for blog/knowledge RAG.

## Why

The whole GBrain two-service architecture ([[2026-06-10-gbrain-multi-user-integration]]) existed for one reason recorded in that decision: *"Render blocked pgvector."* That constraint is gone — Render supports `CREATE EXTENSION vector` on PG13+ databases, and this app **already** runs pgvector (HNSW cosine on `post.embedding` and `knowledge_chunk.embedding`) plus an embedding client (`lib/embeddings.ts`, OpenRouter `text-embedding-3-large`, 1024d).

Keeping GBrain was pure carrying cost: cold-start fragility (widened timeouts + a warm-ping to hide it — see [[2026-06-22-brain-recall-cold-start-timeout]]), per-user OAuth provisioning, admin-token rotation, a second database (Supabase), and a maintained fork. CulinAIre Kitchen built the same feature in-app (native pgvector, single service) and it works.

## What was built

- **`user_memory` table** (migration `0032_user_memory.sql`): `id`, `user_id` (FK→users, cascade), `source_type`, `title`, `body`, `embedding vector(1024)`, timestamps. OLTP/2NF. **No ANN index by design** — recall is an exact cosine scan over one user's slice; a tenant-filtered HNSW under-recalls, and per-user slices are small. Only index is the FK btree on `user_id`.
- **`lib/brain/memory.ts`** — the in-app backend: `recallFromDb` (embed query → exact cosine scan `WHERE user_id` → rank `0.7·sim + 0.2·exp(-ageDays/30)` → top 6), `captureToDb` (sanitize → embed → insert), and the management surface (`listMemoriesFromDb`, `deleteMemoryFromDb`, `deleteAllMemoriesFromDb`, `getMemoryStatusFromDb`). `rankMemories` is a pure, unit-tested function.
- **Synchronous embed, no worker.** Capture embeds inline in the existing fire-and-forget path. On a persistent Render process the detached work completes, and `embedText` already retries 3× — so a background queue/worker (CulinAIre's approach) would add a fragile `setInterval` on Next.js to guard a failure that's already mostly covered. Fewer moving parts = more robust here.
- **Backend branch, not a rewrite.** `recall.ts` and `extract.ts` gained a one-line `memoryBackend()` branch, so `lib/chat/stream.ts` is untouched. The five `/api/brain/*` routes branch the same way; the UI components read the same contract (the pgvector `slug` carries the row id).
- **Cutover flag `MEMORY_BACKEND`** (env var, default `gbrain`), mirroring the existing transitional `INTEGRATION_FALLBACK_ENABLED` pattern. Flip to `pgvector` after backfill; instant rollback by flipping back. Removed with GBrain in the follow-up.
- **Backfill** (`scripts/backfill-brain-to-pgvector.ts`): fetches each provisioned user's GBrain pages over MCP, re-embeds, inserts into `user_memory`. Idempotent (skips users with existing rows). Dry-run by default; `--apply` to write.

## Verification (all on DEV)

- Full suite green: **1205 tests / 116 files**, `tsc` clean. New unit tests (rank/flag) + pgvector route tests (contract + 401/404) + the existing GBrain route tests all pass (no regression).
- **Live e2e** (`tests/eval/brain-pgvector.eval.test.ts`, run via the eval config): real embeddings + real DB proved capture→embed→cosine-recall returns the right memory, and the **A∥B isolation canary** holds (user A's recall never contains user B's memory — the guarantee GBrain nearly shipped broken).
- **Backfill validated on real DEV GBrain data**: 20 memories across 2 users migrated (0 embed failures), recalled via the live cosine path, then cleaned up.

## Cutover runbook (PROD)

1. Apply migration 0032 to PROD (`scripts/db-apply.mjs` against the PROD URL, after `pg_dump` backup — see [[deployment-architecture]]).
2. Dry-run then `--apply` the backfill against PROD (`DATABASE_URL`=PROD).
3. Set `MEMORY_BACKEND=pgvector` on Render, verify, monitor.
4. Rollback = unset `MEMORY_BACKEND`.

## Follow-up (separate PR)

Remove `lib/brain/{client,provision,warm}.ts` (+tests) and the `provision`/`warm` routes, drop the `user_brain` table, remove the `gbrainUrl`/`gbrainAdminToken` config + admin fields, and decommission the GBrain Render service + Supabase + fork.
