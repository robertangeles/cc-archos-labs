---
title: Deploy verification and cron config documentation
category: lessons-learned
created: 2026-06-14
updated: 2026-06-14
related: [[deployment-architecture]]
---

Two failures compounded into a 3-hour production incident on 2026-06-14.

## Problem 1: Silent deploy failure

Render's GitHub App lost access to the cc-archos-labs repo. Auto-deploy stopped after commit 0ad8d55 (June 9). Six PRs (#149-#154) merged to main over 5 days without deploying. Nobody noticed.

**Root cause:** Render's Git Provider permissions were changed (likely when cc-archos-labs-gbrain was added). The cc-archos-labs repo was removed from the allowed list. Render failed silently -- no alert, no failed deploy event in the dashboard.

**Fix:** Restored repo access via GitHub Settings > Installations > Render. Manual deploy pushed all 14 pending commits live.

**Rule:** After every PR merge, verify the Render deploy completed. Check the Events tab. If the latest deploy commit doesn't match the latest main commit, the deploy pipeline is broken.

## Problem 2: Cron job not configured and not documented

The scheduled social publishing feature (PR #153) shipped with a cron endpoint but the Render Cron Job was never created. The wiki log noted it as an "Operator step" but the deployment architecture doc was not updated. When Claude tried to create the cron job, it guessed at Docker images and commands instead of checking how the existing two crons were configured.

**Root cause:** The deployment architecture wiki documented the endpoint URLs but not the exact Render configuration (region, instance type, language, build command, Git Provider vs Docker). Without that, creating a matching cron job required trial and error.

**Fix:** Updated deployment-architecture.md with the exact Render cron job settings table. All three crons now documented identically.

**Rule:**
1. When shipping a feature that requires a new cron job, update `wiki/entities/deployment-architecture.md` in the SAME PR
2. Never use Docker images for Render cron jobs -- use Git Provider with `build: true` and the curl command
3. Never guess at infrastructure configuration. Read the existing working config first and copy it exactly
4. Every cron endpoint PR must include: (a) the route code, (b) the wiki update, (c) explicit instruction to create the Render Cron Job with exact settings

## Problem 3: Wasted time from speculative debugging

When the cron job didn't work, Claude speculated about Docker entrypoints, shell expansion, and image choices instead of following the debugging protocol. Multiple failed attempts wasted significant user time.

**Rule:** Follow the debugging protocol. Get evidence before suggesting fixes. When infrastructure exists that works (the other two cron jobs), inspect it first and copy it. Never invent a new approach when a working pattern exists.
