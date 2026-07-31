---
title: Topic domain and CDMP exam eligibility are separate axes
category: decision
created: 2026-07-31
updated: 2026-07-31
related: [[2026-07-31-audience-scoped-source-disclosure]], [[2026-07-31-retrieval-floor-calibration]]
---

CDMP certification questions were being generated from *The Trusted Advisor*;
the fix is an explicit `is_cdmp_source` flag, not a better category string.

## The defect

`lib/cdmp/generate.ts:173` selected certification practice-exam source material
with:

```ts
searchKnowledge(chapter.label, "dmbok", config.chunksPerQuestion)
```

`category` is a free-text **topic** label. It was being read as an **approval**
flag. Measured in PROD 2026-07-31: 8 of the 19 ready documents carried
`category='dmbok'`, and **6 of those 8 had no business in a certification
pool** — *The Trusted Advisor*, *Flawless Consulting*, *Clean Architecture*,
*The Pragmatic Programmer*, *Designing Data-Intensive Applications* and
*Data Strategy*.

(An earlier draft of this page said 15. That number came from an inference
about stored categories rather than a query, and was wrong — the correct figure
is 6. Counted directly: `SELECT category, count(*) FROM knowledge_document
WHERE status='ready' GROUP BY category`.)

A data-management certification exam was drawing questions from a book about
consulting relationships. Nothing failed. No error, no log, no user-visible
symptom — just quietly wrong questions, in a shipped product.

## Why a better category string would not have fixed it

*The Unified Star Schema* is the case that proves the two questions are
different. It is squarely data-management by topic, so `category='dmbok'` is
correct. But it is built on the Bridge, a proprietary technique that is not DAMA
syllabus, so a CDMP question drawn from it would be unfair. Under a single-axis
scheme there was no way to express "yes to the first, no to the second".

So:

| question | answered by |
|---|---|
| what is this book about? | `category` — one of five topic domains |
| may a CDMP exam question come from it? | `is_cdmp_source` — explicit boolean |

`is_cdmp_source` defaults **false** (migration 0039). A newly ingested document
is not exam material until someone says so. The original bug existed precisely
because the effective default was "yes, if you happened to type dmbok".

## The taxonomy

Five canonical domains, replacing free-text `dmbok`/`supplementary`:

```
dmbok        3    consulting   4    engineering  10    analytics   2    startup  0
```

`startup` has no shelf yet — the library was described as covering it and does
not. Tracked separately as content acquisition, not engineering.

**CDMP pool is exactly two documents:** the DAMA-DMBOK 2nd Edition and
Kimball's *The Data Warehouse Toolkit*.

## How the 19 documents were identified

Not from filenames — those are unreliable and several are meaningless. One
document was titled `ABUIABA9GAAghIK0ugYowM2h3QY`; reading its first chunk shows
it is Chip Huyen's *Designing Machine Learning Systems*.

Each document was identified from sample chunk content by one analyst, then
adversarially reviewed by a second that had not seen the first's reasoning. Two
extraction downgrades were re-verified by hand against the raw text before being
recorded.

**Two documents have damaged extraction:**
- *The Unified Star Schema* — **broken**. 10 chunks for a ~250-page book, against
  a corpus range of 10–496. Over 90% of it is absent from the vector store. The
  sampled text is coherent, which confirms the pipeline stopped early rather
  than mangled what it read.
- *Designing Machine Learning Systems* — **suspect**. Letter-spaced OCR garble in
  table content (`"T a b l e 4 - 3 ."`). Front matter is clean, so any table or
  figure content elsewhere in a table-heavy book is at risk.

Two further documents carry quality notes: *Clean Architecture* (53 chunks, and
the prose reads as content-mill filler rather than the Martin book) and Hamming's
*The Art of Doing Science and Engineering* (filed `engineering`, but it is
research-methodology essays — a taxonomy gap rather than a miscall).

## Guarding it

`lib/cdmp/corpus-scope.test.ts` asserts at source level that every CDMP query
filters on `is_cdmp_source` and that none filters on `category`. Source-level
rather than behavioural because the realistic regression is someone
"simplifying" the filter back to a category string, which reads perfectly
reasonable in a diff. Verified by mutation: reverting one query to
`d.category = 'dmbok'` fails the test.

## Verify with

```bash
node --env-file=.env.local scripts/retag-knowledge-corpus.mjs          # dry run
node --env-file=.env.local scripts/retag-knowledge-corpus.mjs --apply  # snapshots first
```

The script refuses to run if any ready document is missing from the mapping — a
retag keyed by id that silently skipped unknown rows would leave new documents
in a stale category with `is_cdmp_source` at its default.
