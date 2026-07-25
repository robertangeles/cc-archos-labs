---
title: Blog writer agent — operational runbook
category: runbook
created: 2026-07-25
updated: 2026-07-25
related: [[blog-writer-agent]], [[deployment-architecture]]
---

What to do when the daily blog agent misbehaves. Four failure modes, each with a signal and a response.

## First: nothing it does is urgent

The agent never publishes. Every failure path ends in a draft plus an alert, and agent posts only go live when a human clears `needs_review`. A stalled agent means no new posts; it does not mean bad posts.

## Kill switch

```
/admin/prompts/blog-agent-config  →  set enabled: false
```

Takes effect on the next tick, no deploy. Use this before debugging anything. Deleting the Render cron job also works and is the harder stop.

## Health check

```sql
SELECT * FROM cron_heartbeat WHERE id = 'blog-writer';
```

`last_run_at` older than ~25 hours means the cron itself is not firing — check the Render cron job, not the code. `last_run_jobs_failed > 0` means the run completed but produced nothing publishable.

```sql
SELECT status, count(*) FROM content_plan_item GROUP BY status;
```

---

## 1. Research step keeps failing

**Signal:** `[ALERT] Blog agent: a plan item failed`, `last_error` mentions the model returning nothing. Items cycle back to `pending`.

**Cause:** `perplexity/sonar-deep-research` returning a 200 with empty content. Measured at ~1 in 8 historically; the orchestrator already retries once.

**Response:** if it is intermittent, ignore it — the item returns to `pending` and is retried next tick. If it is every run, check the OpenRouter key and credit at `/admin/integrations`, then confirm the model id is still served. Nothing needs fixing in code.

## 2. The judge rejects everything

**Signal:** repeated `a draft was parked for review`. Posts pile up as drafts with `needs_review=true`.

**Cause, in order of likelihood:** the research is thin (the writer has nothing to be specific about, so the grounding check bites); the judge model changed behaviour; or `blog_judge_prompt` was edited into something too strict.

**Response:** read `content_plan_item.judge_verdict` for a parked item. It records the gate and judge findings per round, each quoting the offending sentence. If the quotes are fair, the problem is upstream — the topic was too thin to research. If the quotes look like nitpicking, tune `blog_judge_prompt` at `/admin/prompts`.

> Do **not** respond by raising the rewrite budget. One round is deliberate: an unbounded loop optimises for evading the judge rather than having something to say, which produces polished emptiness — the exact failure the gate exists to prevent.

## 3. The queue is dry

**Signal:** `[ALERT] Blog agent: topic queue is running dry`, or `outcome: "idle"` every run.

**Cause:** `plan.ts` produced nothing. Usually the Perplexity landscape call returned empty; occasionally every generated item had a category that could not be mapped.

**Response:** check `blog_agent_config.categoryMap` still points at slugs that exist in `category`. Then re-trigger manually:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  --max-time 900 https://archoslabs.xyz/api/cron/write-blog-post
```

The response body includes `refill: { inserted, error }`.

## 4. An item is wedged in `running`

**Signal:** `[ALERT] Blog agent: N item(s) gave up after repeated failures`, or a row sitting at `status='running'` with `locked_until` in the past.

**Cause:** the process died mid-run. Render replacing the instance during a deploy is the normal case — a run takes 3-6 minutes, which is a wide window.

**Response:** none needed for the first two occurrences. The sweeper reclaims the row at the top of the next tick and returns it to `pending`. After 3 attempts it is parked as `failed` so a poisonous topic cannot loop forever burning a deep-research call per tick. To retry a parked item:

```sql
UPDATE content_plan_item
   SET status='pending', attempts=0, last_error=NULL
 WHERE id = '<id>';
```

---

## Preflight refused to run

**Signal:** `outcome: "failed"` with a message naming a workflow field id.

**Cause:** a field was deleted and re-added in the Workflows builder. `syncWorkflowFields` mints a brand-new random id when that happens, and the configured map now points at an id no field has.

**Response:** this is the guard working. Read the current ids and repair the map:

```sql
SELECT field_id, label FROM workflow_field
 WHERE workflow_id = '<workflowId>' ORDER BY sort_order;
```

Then update `fieldMap` at `/admin/prompts/blog-agent-config`. Without this guard the agent would have passed inputs keyed to a dead id, received an empty topic, and written a confident, well-formed article about nothing.

## Something bad reached the public site

1. `enabled: false` in config.
2. `/admin/blog/posts` → set the post to `archived` (soft delete, reversible) or `unlisted` to keep the URL alive.
3. Re-submit the sitemap so the delist propagates: `node scripts/indexnow-submit-sitemap.mjs`.
4. Only then investigate. The migration is additive; no schema rollback is ever needed.
