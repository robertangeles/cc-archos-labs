---
title: Blog writer agent — operational runbook
category: runbook
created: 2026-07-25
updated: 2026-07-26
related: [[blog-writer-agent]], [[deployment-architecture]]
---

What to do when the daily blog agent misbehaves. Six failure modes, each with a signal and a response.

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

## 5. Every post is getting the fallback illustration

**Signal:** `imageFallback: true` on every run, or in SQL — a fallback has an
image path but no R2 key, because it is a static asset rather than an upload:

```sql
SELECT id, slug, og_image_path IS NOT NULL AS has_image,
       og_image_r2_key IS NULL AS is_fallback
  FROM post WHERE is_agent_generated ORDER BY created_at DESC LIMIT 10;
```

**Causes, cheapest to check first:**

1. **Illustrations are switched off.** `image.enabled: false` in
   `blog_agent_config`. Deliberate if someone set it; check before digging.
2. **R2 is not configured on the server.** `attachImageToPost` throws
   `R2NotConfiguredError`. Needs `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `R2_PUBLIC_URL` — note the last one
   is `R2_PUBLIC_URL`, not `R2_PUBLIC_BASE_URL`.
3. **The illustration step produced nothing.** Look for `image_prompt` in the
   run's `step_results`. Empty means the step failed; the article still shipped,
   which is by design.
4. **Generation is timing out.** `generateImage` bounds time-to-headers at 25s.
   Measured at 2K: headers at 10.1-10.6s, so there is roughly 2.5x margin. If
   this starts firing, the provider has slowed down — do not "fix" it by raising
   the image size, which is what eats the margin.

**Response:** none of these is urgent. Posts still land and still read fine.
Fix the cause, and the next run picks it up.

## 6. The illustrations have text in them

**Signal:** legible words, letters or numerals in a generated image.

**Cause:** the art director described something readable. The model renders
text whenever the scene implies it — an early version of this prompt described
a ledger and the image came back with a readable company name on it.

**Response:** tighten the skill prompt at `/account/workflows`
(`archos-editorial-illustration`). The rule that works is banning the *object
category* rather than the depiction: no documents, ledgers, books, screens,
charts, rulers, clocks, dials or gauges, because those objects drag text in
whether or not you asked for it. Style and framing are in code and already say
"no text"; that alone was not enough.

## Something bad reached the public site

1. `enabled: false` in config.
2. `/admin/blog/posts` → set the post to `archived` (soft delete, reversible) or `unlisted` to keep the URL alive.
3. Re-submit the sitemap so the delist propagates: `node scripts/indexnow-submit-sitemap.mjs`.
4. Only then investigate. The migration is additive; no schema rollback is ever needed.
