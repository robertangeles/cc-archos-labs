---
title: News draft pipeline — operational runbook
category: runbook
created: 2026-11-02
updated: 2026-11-02
related: [[news-draft-pipeline]], [[news-radar-runbook]], [[deployment-architecture]], [[2026-11-02-news-draft-pipeline-design]]
---

How to turn the Keep-to-draft pipeline on, watch it, and turn it off. What it is: [[news-draft-pipeline]].

## State of each environment

| | Code | `news_draft_*` tables | Skills | Switch |
|---|---|---|---|---|
| DEV | here | applied | seeded | on while testing |
| PROD | ships dormant on merge | **not applied** | **not seeded** | absent (off) |

Merging ships code to PROD and never schema. Until migration 0043 is applied the Radar page works and simply shows no draft line (the query fails soft and logs `[radar] draft status unavailable: <error name>`).

## Activation checklist (PROD) — needs Rob's explicit go

1. **Settings confirmed by Rob 2026-11-02** ([[2026-11-02-news-draft-pipeline-design]]): a Keep starts the whole draft, three per Melbourne day. The PROD go itself is still his.
2. **Back up PROD.** `pg_dump` to `~/archos_prod_backup_<date>.dump` using `DATABASE_URL_RENDER_PROD` (commented in `.env.local`).
3. **Check what PROD has applied:** `select * from __drizzle_applied` should list 0042 and not 0043.
4. **Apply 0043:** `DATABASE_URL="<PROD>" node scripts/db-apply.mjs`. It is two new tables and no change to an existing one; the new tables reference `news_candidate` and `post`.
5. **Seed the skills** with the URL set inline, never exported:
   `DATABASE_URL="<PROD>" node --env-file=.env.local --no-warnings --conditions=react-server --import tsx scripts/seed-news-draft-skills.mts --dry-run`, then again without `--dry-run`. It creates `archos-news-research-brief`, `archos-slop-judge`, `archos-editorial-photo` and derives `archos-ai-news-factcheck` from PROD's own `archos-paul-graham-essays`. It never overwrites a skill that exists, so Rob's later edits win. `archos-thesis-builder` and `archos-steelman-checkpoint` already exist on PROD.
6. **Check the references exist on PROD:** category `ai-news` (with its description), author `Metis`, the OpenRouter key in Integrations (check the second page of the environment list; the default page shows 20 variables).
7. **Switch on:** insert `site_setting` `news_draft_enabled` = `{"enabled": true}` on PROD.
8. **Supervised first run:** Rob presses Keep on one story with a clear primary source. Watch the draft line on the Radar page and `select status, attention_reason from news_draft_job`. Open the draft, read it, click "Mark human-reviewed" only if it is right.

## What the Radar line says

| Line | Meaning | What to do |
|---|---|---|
| Draft queued | waiting its turn (one story at a time) | nothing |
| Drafting now | a run is working, about six minutes | nothing |
| Draft ready. Review it before Mon 01:00 AEDT | a scheduled, needs-review post exists | open it, edit, mark human-reviewed |
| Published | it went live | none |
| Needs you: no primary source found | no fetched document came from the primary source (the story's real source is often paywalled) | write it by hand or skip it |
| Needs you: the research quoted words the sources do not say | a quotation could not be found in any fetched page, after two corrected attempts | the story can be re-queued by deleting its failed job row; or write it by hand |
| Needs you: the draft kept breaking a check / still read as slop | the essay broke a deterministic check or the judge's verdict after the allowed rewrites | open the steps in `news_draft_step` for the reason |
| Needs you: a skill, the category or the author is missing | setup, not content | the detail in `attention_detail` names it |
| Drafting failed: … | the machinery gave up after its tries | check Render logs for `[news-draft]` |

Every job keeps its steps in `news_draft_step` (output, model, tokens, cost, duration): the full trail for reading why a job stopped.

## Numbers from the real runs (DEV, 2026-11-02)

Four to nine minutes and $0.59 to $1.04 of logged text-model cost per finished post, plus about $0.09 for the image and the search (not in the logged figure). Stages: research 60 to 175 s, write 2 to 4 min (thesis, steelman, essay), tighten 40 to 60 s, photo about 1 min, assemble 3 s. A story with no primary source costs nothing and stops in about 12 seconds; a refused story with unverifiable quotes costs under $0.40. Peak memory 225 MB for a run; a Keep answers in 0.22 s.

## Switching off

Set `news_draft_enabled` to `{"enabled": false}` (or delete the row). Nothing new starts, and a run already draining the queue stops after the story it is on. A job whose process died restarts from its first stage when switched back on. Drafts already created are ordinary scheduled posts: unschedule or delete them in the admin.

## Source and use

Built 2026-11-02 on `feature/news-radar-drafting`. Tests: `lib/news-radar/draft/*.test.ts` (pglite for the job rules, scripted models for the stages), `tests/e2e/radar.spec.ts` for the Radar line. A real-model run on DEV found defects tests did not: [[2026-11-02-real-run-found-what-nine-hundred-tests-did-not]].
