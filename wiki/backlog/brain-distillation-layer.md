---
title: Brain distillation layer (extract + consolidate)
category: backlog
created: 2026-07-19
updated: 2026-07-19
related: [[conversational-memory-design]], [[2026-07-16-brain-inapp-pgvector-migration]]
---

Locked implementation spec (CEO + eng review, 2026-07-19). Replaces naive store-every-turn capture with extract → consolidate → (existing) multi-signal recall, so the brain stores clean atomic facts instead of raw turns. Grounded in [[conversational-memory-design]]. Does NOT block shipping the pgvector migration itself.

## Decisions locked
- **Approach:** extract + consolidate (not extract-only; not the full worker/decay build).
- **Mode:** HOLD SCOPE.
- **Consolidation:** batched LLM judge (1 Haiku call/turn) — the only option that supersedes conflicts (staleness = the #1 failure mode in the research).
- **Timing:** synchronous in the existing fire-and-forget capture path. No background worker.
- **Deferred (research says unsolved/fragile):** decay/eviction, memory-type taxonomy, background worker, graph DB.

## Data flow

```
capture(userMsg, assistantMsg)            [fire-and-forget, off the reply path]
   │ sanitizeForBrain (reuse)
   ▼
extractFacts()  ─ 1 Haiku call ─▶ JSON string[]  (atomic, third-person, user facts)
   │  Zod-validate. [] ⇒ store nothing (greeting/question/small-talk).
   ▼
embedText(fact) for each  (reuse; run in parallel)
   ▼
cosine top-k over ACTIVE facts   (WHERE user_id=$1 AND is_active, LIMIT ~8)
   ▼
consolidate()  ─ 1 Haiku judge over {candidates + their neighbors} ─▶
        per candidate: INSERT | SKIP(dup) | REPLACE(existing_id)
   ▼
apply() in ONE transaction:
   REPLACE → UPDATE old SET is_active=false, superseded_at=now(); INSERT new
   INSERT  → insert active row (ON CONFLICT (user_id, md5(body)) WHERE is_active DO NOTHING)
   SKIP    → nothing
```

## Schema — migration `0033_user_memory_consolidation.sql`

Add to `user_memory` (+ `schema.ts`):
- `is_active boolean NOT NULL DEFAULT true`
- `superseded_at timestamptz`   (null unless replaced)
- `source_conversation_id uuid` (provenance; nullable)

Indexes:
- partial `(user_id) WHERE is_active` — recall/list pre-filter over live facts only.
- partial UNIQUE `(user_id, md5(body)) WHERE is_active` — kills the double-insert race; INSERTs use `ON CONFLICT DO NOTHING`.

Recall / list / status queries all gain `AND is_active`.

## New module `lib/brain/distill.ts`

- `extractFacts(userMsg, assistantMsg): Promise<string[]>` — one `callLlmJson()` call (Haiku). Prompt hard-rules: emit only facts the user **explicitly stated or clearly implied**; never infer/embellish; standalone third-person; `[]` for greetings/questions/small-talk. Zod-validate the array; on parse/API failure return `[]` (skip).
- `consolidate(userId, candidates): Promise<Decision[]>` — embed candidates, cosine top-k over active facts, one Haiku judge → `{insert|skip|replace<id>}` per candidate. On judge failure: treat all as `insert` (keep facts).
- `applyDecisions(userId, decisions)` — the transaction above.
- `callLlmJson(model, system, user)` — small typed helper reusing the OpenRouter key/config from integration-config (NOT a new fetch stack).

`captureToDb` (in `memory.ts`) becomes: `const facts = await extractFacts(...)`; if empty return; `applyDecisions(userId, await consolidate(userId, facts))`. Still called fire-and-forget from `stream.ts` (unchanged).

## Config
`extractionModel` in integration-config (admin-controllable), default `anthropic/claude-haiku-4.5`. Ship-gate: eval 10 sample turns; if Haiku fact quality is inconsistent, switch extraction to Sonnet.

## Existing polluted memories
- DEV: start fresh (delete the ~7 junk rows — test data).
- PROD: fold extraction into the backfill script (extract-on-backfill) so migrated GBrain data lands clean. Not a separate migration.

## Tests
- **Unit (mock LLM):** `extractFacts` → `[]` for "hi"/"do you remember me"; facts for real statements. Decision-apply logic given mocked judge output.
- **Consolidation (pglite):** novel→insert, dup→skip, conflict→old `is_active=false` + new inserted.
- **Live eval (`tests/eval/`):** "my name is Rob" ×2 → 1 active fact; "prefer DMBOK" → "prefer DAMA" → DMBOK superseded, recall returns DAMA; greeting → 0 facts; Your Brain shows clean facts, no `## User` dumps.
- **Regression:** existing isolation e2e + recall tests green (recall only adds `AND is_active`).

## Failure modes
| Failure | Behavior |
|---|---|
| extract API/JSON fail | skip turn (store nothing) — never fall back to raw turns |
| judge fail | insert all candidates as novel (keep facts; later turn can supersede) |
| double-send race | partial unique `(user_id, md5(body))` + ON CONFLICT DO NOTHING |
| wrong supersede | soft-delete (`is_active=false`) — recoverable, nothing destroyed |
| hallucinated fact | prompt hard-rule "stated or clearly implied only"; user can delete on /account/brain |

## Files
Add: `drizzle/0033_*.sql`, `lib/brain/distill.ts`, unit + consolidation + eval tests.
Modify: `lib/db/schema.ts`, `lib/brain/memory.ts` (captureToDb + `AND is_active` in recall/list/status), `lib/integration-config*.ts` (extractionModel), `scripts/backfill-brain-to-pgvector.ts` (extract-on-backfill).
Reuse: `embedText`, `sanitizeForBrain`, `getDb`, `rankMemories` (recall unchanged).

## Out of scope
Background worker, memory-type taxonomy (semantic/episodic/procedural), decay/eviction/TTL, graph DB. (Research: unproven on Next.js / unsolved field-wide.)

## Effort
Human ~1 day / CC ~30–45 min. Own branch `feature/brain-distillation`.
