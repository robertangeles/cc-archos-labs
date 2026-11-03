---
title: Post every live blog post to X as an Article
category: decision
created: 2026-11-03
updated: 2026-11-03
related: [[x-article-publishing]], [[integration-config]], [[news-draft-pipeline]], [[deployment-architecture]], [[2026-11-02-remove-skills-workflows-social]]
---

Rob, 2026-11-03: every approved and scheduled blog post that goes live also gets posted on X as an Article. He has a Premium X account and asked for a place to put the X API key. Reviewed by `/plan-ceo-review` (scope reduction) and `/plan-eng-review`, each with a Codex outside voice. Built nothing before the reviews finished. Entity: [[x-article-publishing]].

## What was decided, and why

| Decision | Chosen | Why |
|---|---|---|
| Login style | Four static OAuth 1.0a codes in the encrypted Integrations blob | They never expire, so there is no refresh job, no connect screen and no token table. OAuth 2.0 rotates both tokens on every refresh and the blob write was an unlocked read-modify-write. A paid vendor key was rejected (monthly fee, a third party sees every post). |
| Trigger | A sweep of `post` each cron tick, no edits to the publisher | The post table already records what went live, so a queue derived from it needs no hook in the scheduler, `createPost` or `updatePost`, and covers manual Publish for free. A row inside the scheduler transaction and an inline call after the flip were rejected. |
| Cover image | Kept in v1 | One extra call, and Draft mode is the cheapest place to learn the crop and price. |
| Publish lock | Publish is Draft unless `RENDER` is `"true"` | DEV is a PROD clone. X has no delete endpoint. |
| Build order | Spike first: card, signer, client and converter, then one real draft and one clearly marked test publish, then the queue | Price, publish permission and cover handling were unmeasured. |
| Integration save | `FOR UPDATE` on the read | The Mode switch is the kill switch for public posting. |
| Modules | Five in `lib/x-articles`: oauth1, client, content-state, queue, run | `queue.ts` is the only writer of the table, mirroring `jobs.ts` and `run.ts` in the news pipeline. |
| Table | Six CHECK constraints, `ON DELETE RESTRICT`, four commented indexes, mirroring `news_draft_job` | A false `published` row cannot be corrected on X, so the database refuses impossible states. |
| Cron route | A characterization test lands in PR1, against the unedited route | The route had no test. The edit in PR2 must not change auth, heartbeat or the error response. |
| Deferred | Monitor the `posts-publisher` heartbeat and move that cron to `curl -fsS`; a checkpoint after 20 Articles | Recorded in [[backlog]] and [[open-followups]]. |

## What the outside voice changed

Codex found that a resting `drafted` row has no lease, so the claim must set status and lease in one statement; that every worker-originated transition needs fencing by `claimed_by` and the expected status; and that the retry budget had no counter behind its backoff. All three are in the queue contract in the plan. It also repeated, with no new evidence, that a 24 hour sweep window can miss a post after a long outage. That trade-off was accepted: scheduled posts cannot go live while the cron is down, and a stale heartbeat alerts.

## Not built on purpose

Teaser link post, X view counts in admin, an admin page for needs-attention rows (the runbook SQL covers it), auto-verifying an ambiguous publish, a back-catalogue push, support for tables and code blocks through X's `markdown` entity.
