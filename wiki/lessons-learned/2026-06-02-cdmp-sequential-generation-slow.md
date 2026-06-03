---
title: CDMP question generation was sequential — independent LLM calls must run concurrently
category: lessons-learned
created: 2026-06-02
updated: 2026-06-02
related: [[2026-06-02-local-dev-auth-csrf-oauth-gotchas]], [[local-dev-setup]]
---

A 19-question CDMP exam took 6.8 minutes because generation ran one question at a time; the fix is a bounded-concurrency pool, and the slowness also caused a downstream auth bug.

## Problem

Starting a CDMP practice exam was catastrophically slow and silently lost answers.

- **Measured:** `POST /api/cdmp/start 200 in 6.8min` for only **19 questions** (~21s/question). At that rate a full 100-question exam would take **~36 minutes**.
- **Downstream failure:** every `POST /api/cdmp/answer` and `POST /api/cdmp/complete` afterwards returned **401**. The session cookie's JWT has a **5-minute TTL** ([lib/auth/cookies.ts](../../lib/auth/cookies.ts)), and CDMP API routes only *read* the JWT (`requireUser`) — they never call `refreshSession()`. The 6.8-min blocking `start` outlived the JWT, so by the time the user answered, the token was expired → 401 → the frontend fell back to generating a *new* exam. Looked like "it keeps regenerating."

## Root cause

[lib/cdmp/generate.ts](../../lib/cdmp/generate.ts) `generateQuestionBatch` ran **fully sequentially**: an outer `for` over chapters, an inner `for` over each question, with `await generateSingleQuestion(...)` blocking before the next started. Each question is **2 sequential LLM calls** — generate, then verify (verify depends on generate's output) — times up to `maxRetries` (2). So 19 questions = up to ~38–114 serial LLM round-trips, nose-to-tail.

The questions are **completely independent**. Nothing required them to run in series. `generateStructured` is a plain `fetch` to OpenRouter with no internal queue/mutex ([lib/claude.ts](../../lib/claude.ts)), so concurrency works directly.

## Fix

Replaced the nested serial loop with a **bounded-concurrency pool** (`GENERATION_CONCURRENCY = 12`):

- Flatten the per-chapter distribution into one task per question.
- Run tasks through a fixed set of runners pulling from a shared cursor (no new dependency).
- Results keep input order, so question ordering still matches the requested chapter distribution.
- Generate→verify stays sequential *within* a question (can't parallelize a dependency); only the cross-question dimension is parallelized.

Expected wall-clock: ~ceil(count / 12) waves × ~21s → **20 Q ≈ 40s, 100 Q ≈ 3 min** — inside the 5-min JWT TTL, which also eliminates the 401 cascade as a side effect.

Verified by `tsc --noEmit` (clean) + `lib/cdmp` unit tests (11 pass). **Not yet verified by a real exam run** — `server-only` blocks isolate-benchmarking the function outside Next; first end-to-end run is pending on the dev machine.

## Rule

When an operation does N independent LLM/network calls, **never run them in a serial `for await` loop** — use a bounded-concurrency pool (cap ~8–16 to respect provider rate limits). Two tells that you have this bug: (1) wall-clock scales linearly with item count, (2) per-item latency × count blows past any session/token timeout, producing *secondary* auth failures that mask the real perf problem. Fix the concurrency; don't band-aid the token TTL.

## If 12 isn't fast enough

Levers, in order of effort: raise `GENERATION_CONCURRENCY` (watch OpenRouter 429s); generate multiple questions per LLM call (batch the prompt — bigger change to prompt + parsing + verify); or move generation off the request path entirely (generate first batch fast, stream/lazy-load the rest) so a long exam never blocks a single request. The current fix is the surgical one; these are the next rungs.
