---
title: Local UAT — blog writer agent (PR 1)
category: runbook
created: 2026-07-25
updated: 2026-07-25
related: [[blog-writer-agent]], [[blog-writer-agent-runbook]], [[2026-07-25-no-fabricated-experience]], [[deployment-architecture]]
---

Run this by hand before shipping the blog writer agent. It proves the pipeline works end to end, and — more importantly — that the things which stop it publishing something bad actually stop it. ~40 min, of which ~10 is waiting on models.

- **Branch:** `feature/blog-writer-agent`
- **Cost:** roughly $1–2 in OpenRouter spend. Section D runs the real workflow twice; everything else is free.
- **Safety:** this is localhost against DEV. Even in PROD the agent cannot publish — posts land `scheduled` + `needs_review` and the publisher withholds them. Nothing in this checklist can reach the public site.
- The judgement calls in section E are the point. The mechanics are covered by 1486 automated tests; what tests cannot tell you is whether the gate's standard matches yours.

## 0. Setup (one time)

- [ ] On branch `feature/blog-writer-agent`. `pnpm install` if anything changed.
- [ ] Apply the migration on DEV (idempotent):
      `pnpm db:migrate` → shows `0036_content_plan_item.sql` applied or already applied.
- [ ] Confirm you are pointed at DEV, not PROD:
      `node --env-file=.env.local -e "console.log(new URL(process.env.DATABASE_URL).hostname)"`
      → must print `127.0.0.1`. **Stop if it does not.**
- [ ] Seed the config from what is actually in the database:
      `node --env-file=.env.local scripts/seed-blog-agent-config.mjs --enable --daily`
      → check the printed `fieldMap` labels look right ("What should the article focus on…", etc).
- [ ] Start the dev server: `pnpm dev` → http://localhost:3007
- [ ] Export the secret for the curls below:
      `SECRET=$(node --env-file=.env.local -e "process.stdout.write(process.env.CRON_SECRET)")`
- [ ] (Optional, ~15s, free) run the automated suites first:
      `npx vitest run lib/blog-agent lib/posts-admin/scheduled-publisher.test.ts app/api/cron/write-blog-post`

## A. The endpoint is not open to the world

All four are free and take seconds. `POST /api/cron/write-blog-post` is the only endpoint that can spend money and create content.

- [ ] No auth header → **PASS: 401**
      `curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3007/api/cron/write-blog-post`
- [ ] Wrong token → **PASS: 401**
      `curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer wrong-token-padding-here" localhost:3007/api/cron/write-blog-post`
- [ ] Right secret, wrong scheme → **PASS: 401**
      `curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Basic $SECRET" localhost:3007/api/cron/write-blog-post`
- [ ] Correct token, empty queue → **PASS: 200 and `{"outcome":"idle"}`**, no model call, no spend.
      `curl -s -X POST -H "Authorization: Bearer $SECRET" localhost:3007/api/cron/write-blog-post`

## B. The kill switch works

- [ ] Disable it:
      ```sql
      UPDATE site_setting
         SET value = jsonb_set(value, '{enabled}', 'false')
       WHERE key = 'blog_agent_config';
      ```
- [ ] Hit the endpoint with the correct token.
- [ ] **PASS:** `{"outcome":"disabled"}`. No model call, no post, no spend.
- [ ] Re-enable (`'true'`) before continuing.

## C. Bad config fails loudly instead of writing nonsense

This is the guard against the worst silent failure: a workflow field id that no longer exists means the research step gets an empty topic and the agent writes a confident, well-formed article about nothing.

- [ ] Break one field id:
      ```sql
      UPDATE site_setting
         SET value = jsonb_set(value, '{fieldMap,topic}', '"nonexistent-field-id"')
       WHERE key = 'blog_agent_config';
      ```
- [ ] Queue an item (see D) and hit the endpoint.
- [ ] **PASS:** `{"outcome":"failed"}` and the detail names the missing field id and points at `/admin/prompts/blog-agent-config`. **No workflow ran** — the run returns in under a second, not three minutes.
- [ ] Re-run the seed script to repair the config.

## D. The full pipeline, for real (~4 min, ~$1)

- [ ] Queue one item:
      ```sql
      INSERT INTO content_plan_item
        (batch_id, day_number, title, format, shape, category_id, topic, audience, action, status)
      VALUES (
        gen_random_uuid(), 1,
        'Your business probably has a master data problem. Here is the test.',
        'short', 'diagnostic',
        (SELECT id FROM category WHERE slug = 'data-as-a-decision-infrastructure'),
        'Master data — the core entities a business runs on — is the most expensive data problem to ignore and the easiest to diagnose. Give founders a 3-question test.',
        'Founders whose customers or products appear under multiple names across systems, causing reconciliation errors.',
        'Apply the 3-question master data test to your customer records.',
        'pending'
      );
      ```
- [ ] Run it (allow 15 min; a normal run is 3–6):
      `curl -s -X POST -H "Authorization: Bearer $SECRET" --max-time 900 localhost:3007/api/cron/write-blog-post`
- [ ] **PASS:** `{"ok":true,"outcome":"drafted","postId":"…"}`.
- [ ] Check what landed:
      ```sql
      SELECT status, needs_review, is_agent_generated, word_count, slug
        FROM post WHERE id = '<postId>';
      ```
      **PASS:** `scheduled` / `needs_review = true` / `is_agent_generated = true`.
- [ ] Check the audit trail:
      `SELECT saved_by FROM post_revision WHERE post_id = '<postId>';` → **PASS: `blog-writer-agent`**.
- [ ] Check the plan item closed out:
      `SELECT status, attempts, last_error FROM content_plan_item ORDER BY created_at DESC LIMIT 1;`
      → **PASS:** `drafted`, no error.

## E. Read the post — the judgement calls ★ the actual point

Open `/admin/blog/posts`, find the new post, read it end to end. Tests cannot answer any of these.

- [ ] **Would you publish it?** If not, say specifically why — that reason is the next gate rule.
- [ ] **No invented experience.** No "I spent three months…", no "a client asked me…". The byline is Metis, an AI persona; a personal war story here is fabrication. See [[2026-07-25-no-fabricated-experience]].
- [ ] **Every number is real.** Pick two figures and check them against the research the agent used:
      ```sql
      SELECT jsonb_pretty(step_results) FROM workflow_execution_run
       ORDER BY created_at DESC LIMIT 1;
      ```
      → find the `raw_research` output. **PASS:** each figure in the post appears there.
- [ ] **No laundered evidence.** Watch specifically for magnitude words with no magnitude — "drains millions per year", "a significant share", "large portions of their time". This is the failure the first live run produced and the gate now hard-fails; if you see one, the gate has another hole.
- [ ] **The counter-argument is real**, not a straw man raised to be dismissed.
- [ ] **The close is actionable** — a concrete thing to do, not a motivational line.
- [ ] **No outbound link you did not expect.** Off-allowlist links are stripped, so an unexpected domain in the body means the strip failed.

## F. Review the gate's own reasoning

- [ ] Read the verdict:
      `SELECT jsonb_pretty(judge_verdict) FROM content_plan_item ORDER BY created_at DESC LIMIT 1;`
- [ ] **PASS:** every round is recorded (`rounds` is an array), and every finding quotes an actual sentence from the draft.
- [ ] If `rounds` has more than one entry, the post was rewritten. Read round 0's findings and ask: **did the rewrite genuinely fix the problem, or did it just make the claim harder to check?** That distinction is the whole ballgame.

## G. The publish gate holds ★ most important

The single control standing between an agent draft and the public site.

- [ ] With the agent post still `scheduled` + `needs_review = true`, run the publisher:
      `curl -s -X POST -H "Authorization: Bearer $SECRET" localhost:3007/api/cron/process-scheduled-posts`
- [ ] **PASS:** the agent post is **not** published. `processed` does not include it; its status is still `scheduled`.
- [ ] Prove a human post is unaffected — this is the regression that matters:
      ```sql
      INSERT INTO post (slug, title, content_md, status, scheduled_publish_at, needs_review, is_agent_generated)
      VALUES ('uat-human-post', 'Human post', 'Body.', 'scheduled', now() - interval '1 minute', true, false);
      ```
      Run the publisher again. **PASS:** the human post **publishes** despite `needs_review = true`. Agent posts wait; human posts behave exactly as they always did.
- [ ] Clear the flag on the agent post (the shipped "Mark reviewed" action, or `UPDATE post SET needs_review = false WHERE id = '<postId>';`).
- [ ] Run the publisher once more. **PASS:** now it publishes.
- [ ] Clean up: `DELETE FROM post WHERE slug = 'uat-human-post';`

## H. Recovery from a crashed run

- [ ] Simulate an abandoned run:
      ```sql
      UPDATE content_plan_item
         SET status='running', locked_by='dead-worker',
             locked_until = now() - interval '1 hour', attempts = 1
       WHERE id = '<some item id>';
      ```
- [ ] Hit the endpoint. **PASS:** the response's `swept.reclaimed` is 1 and the item is back to `pending` — the pipeline recovers itself rather than going quiet.
- [ ] Repeat with `attempts = 3`. **PASS:** `swept.exhausted` is 1, the item is `failed`, and it is not retried forever.

## I. Injection resistance (free, no models)

- [ ] Run the security assertions:
      `npx vitest run lib/blog-agent/slop-check.test.ts -t "injection"`
      `npx vitest run lib/workflows/executor.test.ts -t "fence"`
- [ ] **PASS:** research output is fenced with per-call random markers, operator field values are not fenced, and an attacker link in a draft never reaches the published body.
- [ ] (Optional, ~30s, ~$0.03) prove the fence did not degrade output quality:
      `RUN_FENCE_EVAL=1 pnpm eval tests/eval/blog-agent-fence.eval.test.ts`

## Pass criteria

Ship only if **all** of these hold:

1. Sections A, B, C, G and H pass exactly as written. These are the controls; a failure here is a blocker, not a nit.
2. Section G's human-post check passes. If a human's flagged post stops publishing, this change broke an existing feature.
3. You read the post in E and would publish it, or you can name precisely what is wrong with it.
4. No figure in the post is absent from `raw_research`, and no magnitude claim lacks a magnitude.

## Known limits, so they are not mistaken for bugs

- **The grounding check is token matching, not fact-checking.** It catches unsupported invention. It does not catch a real number attached to the wrong claim, or a figure the research itself hallucinated.
- **One rewrite round, on purpose.** A second rejection parks the post as a draft. Unbounded rewriting optimises for evading the judge rather than having something to say.
- **PGlite tests do not prove concurrency.** The queue's `FOR UPDATE SKIP LOCKED` behaviour under two simultaneous workers is unproven by the automated suite; the single-item-per-invocation cron makes it near-impossible to hit in practice.
- **No admin UI yet.** `blog_agent_config` is edited by hand in SQL until the `/admin/prompts/[slug]` editors land in PR 2.

## Before PROD

Not part of this UAT, but do not ship without them — see [[deployment-architecture]]:

- [ ] `pg_dump` backup, then apply `0036` to PROD **by hand before merging**. Merging first ships a route that 500s on a missing table.
- [ ] Confirm the existing `process-scheduled-posts` cron is actually alive in PROD: `SELECT * FROM cron_heartbeat WHERE id = 'posts-publisher';` — the whole design assumes it runs.
- [ ] Confirm no PROD post currently sits `scheduled` with `needs_review = true` (none would be stranded, since the gate also requires `is_agent_generated`, but check).
- [ ] Create the Render cron job: Git Provider source, **not Docker** (env vars do not expand in Docker exec form), `curl --max-time 900`.
- [ ] Seed `blog_agent_config` against PROD ids and leave `enabled: false` until you have watched a run.
