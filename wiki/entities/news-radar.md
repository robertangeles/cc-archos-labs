---
title: News radar
category: entity
created: 2026-10-26
updated: 2026-10-27
related: [[news-radar-runbook]], [[2026-10-26-news-radar-design-amendments-confirmed]], [[2026-10-24-remove-blog-agent-pipeline]], [[integration-config]], [[deployment-architecture]]
---

A feed reader plus a scorer, replacing the deleted AI blog writer's front end. It reads huggingnews.com every two hours, has TypeSafe Jev score each item against a frozen rubric, and keeps the scores so Rob can mark items Keep or Skip. Release 1 is a **shadow week**: it drafts, researches, illustrates and publishes nothing. The gate to Release 2 (drafting) is at least 7 valid days, at least 50 labelled eligible items, a Keep rate of at least 50%, and at least 5 Kept topics Rob would personally write. Thresholds are fixed before data. Plan: `~/.gstack/projects/robertangeles-cc-archos-labs/ceo-plans/2026-10-25-blog-pipeline-rebuild-plan.md` (outside the repo). Operating it: [[news-radar-runbook]].

## Shape (Release 1: PR1 the engine, PR2 the page)

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

## The Radar page (PR2)

`/admin/blog/radar` (a tab beside Settings and Posts). Design: plan DES-D3 to DES-D14; confirmed by [[2026-10-26-news-radar-design-amendments-confirmed]].

- **Blind labelling.** To label is the default view, newest first, with no scores shown. "Show scores" is off by default, page-wide, per browser, and starts off again for each cohort.
- **Label control.** Keep and Skip carry equal weight. Press the other to switch, press the selected one to clear. The row updates instantly and reverts visibly if the save fails ("Couldn't save. Retry"); a 6 second Undo; after a conflict "Use mine". First labels can only be set in To label; the other views are read-only.
- **Status area.** Level one is progress ("Today 3 of 8 labelled", the cohort's progress toward the gate); level two a quiet health line (Healthy, Stale after 3 hours, Failing with a plain cause, Radar is off, no Jev key). "N new . Refresh" appears when new items arrive; the list never reorders on its own.
- **Files.** `app/admin/(authed)/blog/radar/` (server page, loading), `components/admin/radar/` (`radar-list.tsx` client module, `radar-copy.ts` every word, `radar-state.ts` pure label transitions), `lib/news-radar/queries.ts` (one read path for the page, the poll and the gate report), `lib/news-radar/labels.ts` (label rules), `lib/news-radar/gate-report.ts` and `scripts/radar-gate-report.mjs`, `GET /api/admin/radar`, `PATCH /api/admin/radar/[id]`.
- **Label rules** (`labels.ts`): the candidate row is locked first so two tabs serialise; a repeated request id returns the stored result; a stale `ifLatestLabelId` (the id of the newest label row, a `clear` row included) is a 409 with the current label; the same decision as now writes nothing; only scored items can be labelled.
- **Tested.** pglite for the rules and queries, server-render tests for every state and its exact copy, a token contrast test, and Playwright at 375, 768 and 1280 wide (keyboard only, reduced motion, an axe check with no WCAG A or AA violation, a 400-row backlog, conflict and save-failure states).

Until the PROD migration is applied the tab shows "Couldn't load the radar." with a Retry, never an error page.

## Not built yet

- **Follow-ups**: an admin toggle for the `news_radar_enabled` flag (today it is a `site_setting` row, so "Radar is off" tells Rob to set it); a rubric editor in the admin (the CLI is the interim path); moving the three live cron writers to the shared heartbeat helper; reading the embedding key from the Integrations store (today `lib/embeddings.ts` reads `OPENROUTER_API_KEY` from the environment); the admin contrast debt (DES-D16, existing pages use `text-primary` links at 4.05:1); run /design-review on the live page once it has real data.
- **Rubric**: approved 2026-10-27, picks stories for the Behind the AI Headline method ([[2026-10-27-news-radar-rubric-v2-approved]]); DEV version 2, PROD none yet.
- **Open for Rob**: explicit PROD database go-ahead; the PROD Jev key ([[backlog]] item 52). Activation order is in [[news-radar-runbook]].
