---
title: I tested the X pipeline on DEV with an old post while the real flow was PROD and the AI News posts
category: synthesis
created: 2026-11-04
updated: 2026-11-04
related: [[x-article-publishing]], [[x-articles-runbook]], [[2026-11-03-x-articles-autopost]], [[news-draft-pipeline]], [[deployment-architecture]]
---

## Problem

Rob's deal: every post that goes live is also posted to X as an Article, and PROD is the one that does it. After the code merged dormant I reported "everything is ok" and planned the next step as a DEV test with an August blog post, because DEV had the keys and PROD had none. Rob then asked why nothing was posted. Four things were wrong at once:

1. **The test was not the real flow.** Three AI News posts had gone live on PROD in the previous 20 hours (the 9:00, 15:00 and 21:00 New York slots) and I was drafting a three-month-old post on a laptop copy.
2. **A time window closed while I did something else.** The draft cap reset at 06:59 UTC. My hand-made DEV queue row went stale at 08:20 UTC (the 24 hour rule counts from the row's `created_at`). I ran the test at 09:30 UTC and my own guard had already closed the row. The run summary said `attention: 0` for a row that had just moved to `needs_attention`.
3. **"Merged dormant" was reported as done.** Nothing had told Rob the table, keys and Mode were still missing on PROD, so the first sign was a missing Article.
4. **A script write is invisible to the running service.** The integration config is cached in the web process until a restart (`lib/integration-config.ts`, single-instance assumption). I wrote the keys and Mode to PROD, the health check kept saying `mode: off`, and nothing was swept for 8 minutes.

## Fix

Backed up PROD (`~/archos_prod_backup_20261104_pre0046.dump`), checked that 0046 was the only untracked migration, applied it by hand with `scripts/db-apply.mjs`, moved the four keys DEV to PROD through a pipe with no file and no printed value (`updateIntegrationSecret`, audited), proved them with `getMe` (connected as `@archoslabsxyz`), set Mode to Publish, ran `render restart`, and watched the first tick: `swept 3, published 3, attention 0`, all three live on X.

## Rule

- **Test against the real trigger.** The test of a pipeline that PROD's cron drives is PROD's cron on PROD's newest posts, not a fixture on DEV. DEV is for proving code, never for deciding that the feature works.
- **"Merged" and "dormant" are not "done".** Say what is still missing for the outcome Rob asked for (here: PROD table, keys, Mode) in the same message that reports the merge.
- **When a limit resets or a window opens, run first, tidy later.** Put the time in the plan and run at that time.
- **After writing config from a script, restart the service and read the health body** before believing it.
- **Any state change that moves a row must show in the run summary.** `recoverStale`'s count is not in `XRunSummary`; the health check caught it only because it counts `needs_attention` rows. Backlog item.
