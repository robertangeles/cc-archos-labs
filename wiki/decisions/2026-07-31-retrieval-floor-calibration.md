---
title: Retrieval similarity floor — calibrated from data, not guessed
category: decision
created: 2026-07-31
updated: 2026-07-31
related: [[deployment-architecture]]
---

The chat RAG floor of 0.3 never fires; the honest discriminator is retrieval
DEPTH at 0.42, not top-1 score.

## Context

`lib/chat/stream.ts:72-75` runs one `vectorSearch(rawUserTurn, undefined, 5)`
per chat turn and keeps chunks scoring `> 0.3`. Nobody had ever measured what
those numbers do against the real 19-book PROD corpus. Measured 2026-07-31 via
`scripts/retrieval-baseline.mjs` (18 questions the library covers, 8 startup /
founder questions it has zero books for).

## What the measurement found

**1. Retrieval is single-source far more often than assumed.**

```
TODAY      K=5, no cap              avg 1.72 distinct books   (min 1, max 3)
CANDIDATE  K=30, cap 2/doc, take 8  avg 3.83 distinct books   (min 2, max 5)
Single-book turns today: 8 of 18
```

Nearly half of all turns ground the answer in exactly one book. A wide retrieve
with a per-document cap more than doubles source diversity for zero extra model
calls.

**2. The 0.3 floor is decorative — it never fires.**

Every chunk of every question, covered or not, clears 0.3. Real scores sit
0.31-0.70. So the "no book covers this" branch is currently unreachable: ask
Metis about seed-round dilution and it returns McKinsey Mind chunks at 0.31-0.47
and treats them as grounding.

**3. Top-1 score is a fragile discriminator. Depth is not.**

```
answerable   top-1: min 0.492  median 0.606  max 0.703
unanswerable top-1: min 0.308  median 0.447  max 0.466
separation: 0.025   <-- one lucky chunk decides the verdict
```

Counting how many chunks clear a threshold separates far better:

```
thresh | answerable min/med/max | unanswerable min/med/max | margin
 0.42  |    15 / 30 / 30        |     0 /  3 /  8          | +7 chunks
 0.44  |     8 / 30 / 30        |     0 /  1 /  3          | +5 chunks
```

A covered question has *many* chunks above 0.42. An uncovered one has a couple
of near-misses and nothing behind them.

## Decision

- **Retrieval floor: 0.42** (was 0.3).
- **Gap signal (E8a) fires when fewer than 12 chunks clear 0.42.** Covered
  questions clear it with ≥15; uncovered peak at 8.
- Both constants are owned by the eval harness and retuned when the corpus
  grows. They are corpus-relative, not universal.

## The trap this nearly fell into

Threshold 0.40 showed a wider margin (+14) and looked like the better choice.
It is an artifact: at 0.40 *every* answerable question returned the full K=30,
so the count was censored by the window edge, not separated by the data. The
true count is above 30 and unmeasurable at that K. Any gate derived from it
would break the moment `WIDE_K` changed.

**Rule: when sweeping a threshold against a top-K window, discard any row where
the measured count saturates K.** `scripts/retrieval-baseline.mjs` now detects
and labels this automatically rather than relying on someone noticing.

## Verify with

```bash
DATABASE_URL="<prod>" OPENROUTER_API_KEY="<key>" node scripts/retrieval-baseline.mjs
```

Baseline artifact: `retrieval-baseline-prod.json` — a point-in-time record.
It becomes unreproducible once the E1 retag and E5 re-ingest change the corpus,
which is why it is committed rather than regenerated.
