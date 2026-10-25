---
title: News radar
category: entity
created: 2026-10-26
updated: 2026-10-26
related: [[news-radar-runbook]], [[2026-10-24-remove-blog-agent-pipeline]], [[integration-config]], [[deployment-architecture]]
---

A feed reader plus a scorer, replacing the deleted AI blog writer's front end. It reads huggingnews.com every two hours, has TypeSafe Jev score each item against a frozen rubric, and keeps the scores so Rob can mark items Keep or Skip. Release 1 is a **shadow week**: it drafts, researches, illustrates and publishes nothing. The gate to Release 2 (drafting) is at least 7 valid days, at least 50 labelled eligible items, a Keep rate of at least 50%, and at least 5 Kept topics Rob would personally write. Thresholds are fixed before data. Plan: `~/.gstack/projects/robertangeles-cc-archos-labs/ceo-plans/2026-10-25-blog-pipeline-rebuild-plan.md` (outside the repo). Operating it: [[news-radar-runbook]].

## Shape (Release 1, PR1: engine, dormant)

```
Render cron 0 */2 * * *  ->  POST /api/cron/news-radar  (Bearer CRON_SECRET)
   -> lib/news-radar/radar.ts runTick(slot)
        pin the latest rubric version once
        feed.ts   fetch + strict Atom extract  -> news_candidate (dedupe on source_url)
        claim     FOR UPDATE SKIP LOCKED, random per-run token, 5 min expiry
        per item  novelty (nearest published post) + curator.ts (Jev, typed answers)
                  -> ONE statement writes all score rows, gated on the claim owner
        tick log  news_radar_tick, one row per finished tick
Read side (never written by the cron):
   decide.ts (pure)  eligibility from an item's own scores vs the cohort's cut-offs
   /api/health/cron?id=news-radar
```

| File | Role |
|---|---|
| `lib/news-radar/radar.ts` | the tick: claims, scoring, stale-commit guard, tick log, time budget |
| `lib/news-radar/feed.ts` | Atom extractor, https and host pinned, 1 MB cap, no DOCTYPE, no dependency |
| `lib/news-radar/curator.ts` | Jev client: pinned model, typed answers validated with zod, named errors, 429/529 backoff |
| `lib/news-radar/rubric.ts` | the rubric schema; also imported by `scripts/radar-rubric-set.mjs` |
| `lib/news-radar/decide.ts` | eligibility, ordering, Melbourne day, cohort, gate counts, missed-day rule |
| `lib/cron-heartbeat.ts` | shared heartbeat upsert/read for new cron routes |
| `drizzle/0042_news_radar.sql` | five tables |

## Rules that matter

- **The shortlist is never stored.** It is derived from an item's own scores and its cohort's frozen cut-offs, so a later, better item can never push out one Rob already judged. The daily cap N only limits what the page shows.
- **A cohort is the rubric version of an item's earliest score row.** Changing the rubric, model or cut-offs is a new version, a new cohort, and restarts the 7-day window.
- **A stale tick cannot write.** The score write is one data-modifying statement whose UPDATE checks `claimed_by` against this run's token; if the claim was taken over, zero rows change and no score is written. Proven in `radar.test.ts` and `tests/radar-schema.test.ts` (and by mutating the predicate, which fails them).
- **A crashed tick writes no tick row**, which is how a missed slot shows up for the gate and the health check. A retry of a slot may replace a failed or disabled row, never an ok or partial one.
- **Fail closed.** No rubric, an invalid rubric, no Jev key, a Jev auth error: the tick fails and gives its items back untouched. Jev answering badly three items in a row stops the tick.
- **Labels and scores are evidence.** The foreign keys are RESTRICT; nothing deletes them.
- **Source use.** Discovery only, never republished (HuggingNews publishes `use=reference`).

## Verified live (DEV, 2026-10-26)

One real tick: 33 live feed items, all scored by `jev-1.14.0` with real embeddings, in 34 s for 25 items (about 1.4 s each); a crashed first run left 25 claimed items that the next tick recovered. A real run found a bug the pglite tests could not (postgres-js cannot bind a JS Date in raw SQL); fixed with an ISO string and a comment.

## Not built yet

- **PR2**: admin label routes, the Radar page (`/admin/blog/radar`), gate report script, Playwright spec. Needs the design amendments DES-D6 (`clear` label, allowed by the schema already) and DES-D7 ("Use mine") confirmed by the eng review first.
- **Follow-ups**: rubric editor in the admin (the CLI is the interim path), moving the three live cron writers to the shared heartbeat helper, reading the embedding key from the Integrations store (today `lib/embeddings.ts` reads `OPENROUTER_API_KEY` from the environment).
- **Open for Rob**: rubric v1 wording and the cut-offs T, C, M, N (values, before the evaluation cohort); explicit PROD database go-ahead; the PROD Jev key ([[backlog]] item 52).
