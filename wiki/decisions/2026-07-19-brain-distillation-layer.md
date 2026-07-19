---
title: Brain distillation layer — extract + consolidate (shipped)
category: decision
created: 2026-07-19
updated: 2026-07-19
related: [[conversational-memory-design]], [[brain-distillation-layer]], [[2026-07-16-brain-inapp-pgvector-migration]]
---

The brain now stores clean atomic facts with dedup + supersede-on-conflict, instead of raw chat turns. Built off the research in [[conversational-memory-design]] and the locked spec [[brain-distillation-layer]].

## What changed

Capture was `store the whole turn` → now it is **extract → consolidate**:
- `lib/brain/distill.ts`: `extractFacts(userMessage)` (one Haiku call → atomic third-person facts from the USER message only — never the assistant reply, which is where confabulation came from; `[]` for greetings/questions), then `consolidateAndApply()` (embed each fact → cosine-nearest existing facts → one Haiku judge → insert / skip-duplicate / replace-supersede) in a single transaction.
- `captureToDb` (memory.ts) is now `extractFacts → consolidateAndApply`; recall/list/status filter `WHERE is_active`.
- Migration `0033`: `user_memory` + `is_active` / `superseded_at` / `source_conversation_id`, a partial index `(user_id) WHERE is_active`, and a partial UNIQUE `(user_id, md5(body)) WHERE is_active` (the double-insert guard; INSERTs use `ON CONFLICT … DO NOTHING`).
- Supersede is a **soft-delete** (`is_active=false`), so a wrong call is recoverable.
- Extraction model: env var `BRAIN_EXTRACTION_MODEL` (default `anthropic/claude-haiku-4.5`), same cutover-knob pattern as `MEMORY_BACKEND`.

## Decisions (locked in CEO + eng review)

- Consolidation = **batched LLM judge** (1 call/turn) — the only option that supersedes conflicts (staleness is the #1 failure mode in the research), verified live.
- Synchronous in the existing fire-and-forget path; **no background worker** (fragile on Next.js).
- **Deferred:** decay/eviction (unsolved field-wide), memory-type taxonomy, worker, graph DB.

## Deviations from the spec (flagged)

- Extraction reads the **user message only** (not the assistant reply) — the sharpest anti-confabulation fix.
- `BRAIN_EXTRACTION_MODEL` is an **env var**, not an integration-config field — consistent with the feature's own `MEMORY_BACKEND` env-var pattern, far less surface.

## Verification (all on DEV)

- `pnpm tsc` clean; **full suite 1218 tests green** (13 new `distill.test.ts` units + no regression).
- Unit tests caught a real robustness bug: `parseFacts` was fail-closed on one bad element → made lenient (drop bad elements, keep good).
- **Live eval** (`tests/eval/brain-distillation.eval.test.ts`): stores clean facts (not `## User` turns), **dedups** (same statement twice → one fact), **supersedes** ("DMBOK" → "DCAM" soft-deletes the old, recall returns DCAM), ignores greetings.
- **Playwright e2e** (`brain-isolation.spec.ts`) under a live pgvector server: capture-via-chat distilled `"The user's confidential project codename is NIGHTINGALEFOUR."` (clean fact, not a raw turn) and per-user isolation held end-to-end.

## Rollout

Runs whenever `MEMORY_BACKEND=pgvector` (still default `gbrain`, so PROD unchanged). At the PROD cutover, the backfill re-distills GBrain pages into facts (`scripts/backfill-brain-to-pgvector.ts`, extract-on-backfill). Existing DEV raw-turn rows on the test account can be cleared via `/account/brain`.
