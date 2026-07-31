---
title: Multi-perspective retrieval — what the measurements killed
category: decision
created: 2026-07-31
updated: 2026-07-31
related: [[2026-07-31-retrieval-floor-calibration]], [[2026-07-31-corpus-taxonomy-and-cdmp-pool]], [[2026-07-31-audience-scoped-source-disclosure]]
---

Retrieval went from 1.72 to 4.75 distinct books per turn. Most of the designed
complexity was deleted after measurement, not before.

## Result

```
BASELINE  vectorSearch(rawTurn, undefined, 5), floor 0.3   1.72 books/turn
SHIPPED   retrieve() end to end                            4.75 books/turn
```

## What the design specified, and what survived

| Specified | Verdict | Evidence |
|---|---|---|
| Per-document cap | **KEPT** — the load-bearing step | K=8 → 2.13, K=12 → 2.88, K=30 → 3.88 books |
| Wide candidate pool | **KEPT**, K=30 for a single query | a narrow pool starves the cap; it needs alternatives |
| Domain-scoped fan-out | **DELETED** | 3.88 → **3.38**. It made diversity *worse* |
| Diversity swap (step 6) | **DELETED** | fired 0/8 questions, +0.00 books |
| Query rewriting | **KEPT**, but conditional | raw follow-up top-1 0.421 → rewritten 0.617 |
| Rewrite on every turn | **DELETED** | ~1.8s on turns that gain nothing |

### Why domain fan-out hurt

Filtering each sub-query to a topic domain narrows the candidate set to one
shelf — and the shelves are uneven. `engineering` holds 10 books, `analytics`
holds 2. A domain-scoped search therefore returns chunks concentrated in *fewer*
documents than an unfiltered one. The intuition ("search each domain to get
variety") is backwards when the domains are unbalanced.

Multiple *unfiltered* rewrites still help: 3 queries × K=10 scored 4.67 books and
mean relevance 0.579, against 4.33 / 0.501 for one query at K=30. It was the
filter that hurt, not the fan-out.

### Why step 6 was deleted

The kill criterion was written into the code *before* the measurement: fire rate
and relevance cost were both instrumented, with "delete if it fires often while
dragging score down" stated in the comment. It fired on 0 of 8 questions, because
steps 1-5 already reach 3.9 sources on a healthy pool. It could only ever have
fired on degraded paths, forcing in a lower-scoring chunk to satisfy a document
count — and that count is the eval harness's own primary metric, which made it a
heuristic tuned to the measure that judged it.

Deleted with its unit tests. Keeping tests for removed behaviour is how a suite
starts lying.

## Two bugs the end-to-end run caught that unit tests could not

**The decompose timeout was under half the real latency.** Budgeted at 700ms;
Haiku measured 1.5–1.8s. It timed out on *every* turn, silently reducing
retrieval to a single raw query at the starved K=12 — worse than not trying.
Unit tests passed throughout, because the fallback path is correct; it was just
always being taken.

**`degraded` was lying.** `searchKnowledge` catches a vector failure and quietly
retries with keyword search, so a dead embedding API returned results and looked
perfectly healthy. `retrieve()` now calls `vectorSearch` and `keywordSearch`
itself so `paths` reports what actually served, and a total embed outage sets
`degraded: true` even though chunks came back.

Verified by breaking the env key: `paths: ["keyword"]`, `degraded: true`, 8
chunks from 5 sources still served.

## Score scales are never mixed

Vector returns cosine similarity (0-1); keyword returns a points total landing
in the tens (observed `topScore: 31`). Both arrive as `similarity` and
`mergeDiverse` sorts on it.

A first version only flagged the case where EVERY sub-query fell back to
keyword. Review caught that the realistic case is 2 of 3 succeeding — and in
that mix the keyword chunks take every top slot regardless of relevance, while
`degraded` reported healthy. Simulated and confirmed.

The pool is now kept homogeneous: if any vector search succeeded, only vector
results are used and keyword results are discarded. Keyword serves solely when
vector is entirely unavailable. `degraded` fires in both cases — a total outage,
or any sub-query whose results had to be dropped.

On the keyword-only path the floor and `covered` remain meaningless (points, not
cosine). Not normalised — a mapping between "cosine 0.6" and "13 points" would
be invented — but that path is flagged `degraded`, which `stream.ts` treats
ahead of coverage.

## Four states, not three

An early version had three. Review found the partial-coverage branch injected
real titled excerpts and then appended the *uncovered* notice, which asserts
"nothing relevant was retrieved, so naming one would be an invention" — flatly
false with excerpts directly above it. Telling the model both at once is worse
than telling it neither.

```
grounded    enough material            -> inject it
thin        some, below the gate       -> inject it, with the THIN caveat
uncovered   nothing                    -> inject nothing, say so
degraded    could not look             -> service failure, worded separately
```

## A concurrency bug found while fixing the above

`paths` was populated by `push()` from inside N concurrent callbacks, then used
to index the results array. The completion order of concurrent promises is not
`Promise.all`'s output order, so the two could not be zipped — the pool-filtering
fix would have silently mis-attributed which sub-query used which path. Each
sub-query now carries its own path back in its result.

`coverageNotice()` is audience-aware for the same reason everything else is:
telling a client "I could not reach the library" confirms a library exists,
which the protection block forbids. The client wording carries the same
epistemic fact with no disclosure — asserted by a test that fails if any
corpus-implying word appears, verified by mutation.

## Rollout

`RETRIEVE_FANOUT_ENABLED` (default false) gates only the rewrite call. With it
off, retrieval is one wide query — already 3.88 books, well above the 1.72
baseline. Both states are safe; the flag exists so the rewrite can be pulled
without a deploy.

## Verify with

```bash
RETRIEVE_FANOUT_ENABLED=true pnpm eval tests/eval/retrieval-diversity.eval.test.ts
```
