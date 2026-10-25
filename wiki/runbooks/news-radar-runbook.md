---
title: News radar — operational runbook
category: runbook
created: 2026-10-26
updated: 2026-10-26
related: [[deployment-architecture]], [[integration-config]], [[reset-admin-password]]
---

The news radar reads the HuggingNews feed every two hours, has TypeSafe Jev score each item against a frozen rubric, and keeps the scores for a Keep/Skip shortlist (Radar page, PR2). Release 1 drafts, researches, illustrates and publishes **nothing**. Plan: `~/.gstack/projects/robertangeles-cc-archos-labs/ceo-plans/2026-10-25-blog-pipeline-rebuild-plan.md` (outside the repo).

## What exists after PR1 (dormant)

| Piece | Where |
|---|---|
| Tables (five) | `drizzle/0042_news_radar.sql`: `news_candidate`, `news_radar_rubric`, `news_candidate_score`, `news_candidate_label`, `news_radar_tick` |
| Tick | `lib/news-radar/radar.ts` `runTick(slotAt)` |
| Feed reader | `lib/news-radar/feed.ts` (strict in-repo Atom extractor, no dependency) |
| Jev scorer | `lib/news-radar/curator.ts`, rubric schema `lib/news-radar/rubric.ts` |
| Shortlist / gate logic | `lib/news-radar/decide.ts` (pure; used by the Radar page and gate report in PR2) |
| Cron route | `POST /api/cron/news-radar` (Bearer `CRON_SECRET`) |
| Health | `GET /api/health/cron?id=news-radar` |
| Rubric CLI | `scripts/radar-rubric-set.mjs` |
| Jev key | Admin, Integrations, Jev (TypeSafe) |
| Flag | `site_setting` key `news_radar_enabled`, `{"enabled": true}`; **absent means off** |

PR1 merging does not start anything: the flag is off and there is no Render cron job. Merging ships code to PROD, never schema.

## Activation checklist (PROD)

Do these in order. Nothing here is done by merging.

1. **Database request.** Rob asks for the PROD migration explicitly (CLAUDE.md). Then: `pg_dump` backup, check `__drizzle_applied` on PROD, and `DATABASE_URL="<PROD>" node scripts/db-apply.mjs` (idempotent; applies `0042` only if it is the only untracked one; read the output). The migration is purely additive.
2. **Jev key on PROD.** Integrations, Jev (TypeSafe): paste the key, press Test TypeSafe. Backlog item 52 covers using the DEV key value until a PROD key is issued.
3. **Embedding key.** Novelty uses `findSimilarPosts`, which reads `OPENROUTER_API_KEY` from the **environment** (`lib/embeddings.ts`), not the Integrations store. Confirm it is set on the PROD web service. If it is missing, items are still scored but have no novelty and are never eligible (the page shows "novelty unavailable").
4. **Request time limit.** A tick stops picking up items after about 50 s (`TIME_BUDGET_MS` in `radar.ts`). Confirm Render does not cut a web request sooner. A cut tick writes no row and shows as a missed slot.
5. **Warm-up rubric.** Write a rubric JSON (see below) and run
   `DATABASE_URL="<PROD>" node --no-warnings scripts/radar-rubric-set.mjs rubric.json`
   (use `--dry-run` first). The version is a database identity; you cannot pick it.
6. **Render cron job.** Do not invent a setup. Open an existing working cron job (the posts-publisher one) and copy it exactly: same service type, same command shape, same `CRON_SECRET` handling. Only the schedule (`0 */2 * * *`, UTC) and the path (`/api/cron/news-radar`) change.
7. **Smoke, flag off.** `curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" https://archoslabs.xyz/api/cron/news-radar` returns 200 with `"dormant": true` and writes a `disabled` tick row. A wrong or missing secret returns 401 or 503.
8. **Turn it on.** `INSERT INTO site_setting (key, value) VALUES ('news_radar_enabled', '{"enabled": true}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`
9. **Smoke, flag on.** One curl: expect `outcome: "ok"`, about 40 new items scored. Then the claim checks: two curls at the same moment (the second must not rescore the first's items), and the **expiry case**: stall one tick past the claim lifetime (about 5 minutes), let a second tick take the items, and confirm the first tick's late commit changes nothing (this is the case `radar.test.ts` proves sequentially).
10. **Monitoring.** Rob adds an UptimeRobot check on `/api/health/cron?id=news-radar` (200 healthy, 503 alert).

## Warm-up versus evaluation

The gate (decision D11) needs a **frozen** rubric and cut-offs for the whole window, approved by Rob before day one. Until the Radar page exists:

- **Warm-up version** (throwaway): collect for a few days to prove the feed, the key, claims and monitoring. Excluded from the gate.
- **Evaluation version**: create it **after** PR2 is live, monitoring is verified and the claim smoke is done. The 7-day window starts with it. Any later change (wording, model, cut-offs) is a new version, a new cohort, and restarts the window.

Rubric v1 wording and the cut-offs (T audience fit, C confidence, M novelty distance, N daily cap) are **Rob's to set**; the example below is only the file shape.

```json
{
  "model": "jev-1.14.0",
  "questions": {
    "audience_fit": {
      "instructions": "How useful is this news to a senior data and AI leader running a program in a regulated industry (financial services, healthcare, government)?",
      "criteria": [
        "Irrelevant to that reader",
        "Of passing interest",
        "Useful context for that reader",
        "Directly affects how that reader should run a program"
      ]
    }
  },
  "cutoffs": { "audienceFit": 2, "confidence": 0.6, "minNoveltyDistance": 0.3, "dailyCap": 3 }
}
```

`model` must be an exact version (`jev-1.13.0`, `jev-1.14.0`), never an alias. `minNoveltyDistance` is the smallest cosine distance from the nearest published post that still counts as novel (0 identical, 2 opposite).

## Reading the health check

`GET /api/health/cron?id=news-radar` (no id is the booking monitor and is unchanged; other ids return 400).

| Field | Meaning |
|---|---|
| `stale` | no tick finished for 5 hours (two missed ticks) |
| `feedFrozen` | no feed item newer than 12 hours behind green ticks (skipped when the radar is disabled) |
| `lastTick.outcome` | `ok`, `partial` (some items failed or the tick stopped early), `failed`, `disabled` |
| `lastTick.errorClass` | `NoRubric`, `RubricInvalid`, `JevKeyMissing`, `FeedFetchError`, `FeedParseError`, `JevAuthError`, `JevRateLimitError`, `JevOverloadedError`, `JevShapeError` |

503 when stale, frozen, or the last tick failed.

| Symptom | Cause and fix |
|---|---|
| `JevAuthError` | Jev key wrong or revoked. Fix it in Integrations, Test TypeSafe. The tick stopped and gave its items back, so nothing is lost. |
| `JevKeyMissing` | no key stored. |
| `NoRubric` / `RubricInvalid` | add or fix a rubric version with the CLI. |
| `FeedFetchError` | HuggingNews unreachable or too slow. The tick still scored its waiting backlog. If it persists, `feedFrozen` follows. |
| `JevRateLimitError` | Jev rate limits after retries; the tick stopped early and the rest wait for the next one. |
| items stuck `unscored` | retried each tick, three attempts, then `failed` (terminal, kept for review). |
| health 503 and no tick row at all | the tick crashed (a crash writes no row, by design). Check the Render logs for `[cron/news-radar] tick crashed`. |

## Rollback

Flag off (instant): `UPDATE site_setting SET value = '{"enabled": false}' WHERE key = 'news_radar_enabled';`. Then delete the Render cron job. Revert the PR if needed. The tables are additive and stay; labels and scores are evidence and are never deleted (the foreign keys restrict it).

## Source and use

The feed is read for discovery only. HuggingNews publishes `Content-Signal: search=yes, ai-train=no, use=reference`, and blocks several AI crawlers by name. The radar identifies itself (`ArchosLabsNewsRadar/0.1`), reads one feed every two hours, and **never republishes** a feed item. Revisit this before Release 2 drafts anything from a source.
