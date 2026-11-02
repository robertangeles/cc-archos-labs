---
title: News draft pipeline
category: entity
created: 2026-11-02
updated: 2026-11-02
related: [[2026-11-02-remove-skills-workflows-social]], [[news-radar]], [[news-draft-runbook]], [[2026-11-02-news-draft-pipeline-design]], [[2026-11-02-real-run-found-what-nine-hundred-tests-did-not]], [[news-radar-runbook]]
---

Release 2 of the news radar. When Rob presses **Keep** on a story, the pipeline turns it into a scheduled, human-review-required blog draft in his Behind the AI Headline method: go to the primary source, say what the headline left out, give a verdict. It never publishes anything by itself.

## Shape

```
Keep pressed (PATCH /api/admin/radar/[id])  or  the radar's 2-hourly tick
   -> kickDrafting()  -> after(): the response is already sent
        startDraftIfDue   switch on? queue the Kept stories, recover dead jobs, claim ONE job
                          (Melbourne-day cap), then drain the queue one story at a time
          runJob          research -> write -> tighten -> photo -> assemble
                          lease pushed out before every stage; a lost lease stops the run
```

| Stage | What it does | Model |
|---|---|---|
| research | Sonar finds candidate URLs; the code fetches them itself (SSRF-guarded, `lib/news-radar/source.ts`) and classifies primary or secondary; Sonnet writes a brief from the fetched text only. Every quotation in the brief must exist in a fetched page or the headline coverage; two corrected attempts, then stop | `perplexity/sonar-pro`, `anthropic/claude-sonnet-5.5` |
| write | Rob's thesis and steelman skills, then the news fact-check essay skill (`archos-ai-news-factcheck`, forked from his Paul Graham essay skill; inferences are written in words, "I infer", not with an `[Inference]` tag, and the SEO title limit is stated as the real 46 (his skill says 60, the site appends its own name) so the first draft passes the length check, which the checks reject and the old blog agent shipped as a defect) | `anthropic/claude-sonnet-5.5` |
| tighten | Deterministic gates (quotes, numbers, verdict word, no links or Sources from the writer, SEO title and meta lengths, tags) plus Rob's slop judge. Its "What to tighten" notes feed up to three rewrites (`maxRewrites`, default 3; a failed check counts as a rewrite too). From its second read on, the judge is handed its own earlier notes and asked to close what was fixed (a fresh judge re-reviews from scratch and finds new nitpicks every time, so the loop never converges) | writer above; judge `deepseek/deepseek-v4-flash-0731` |
| photo | A photo brief, then a realistic image (Rob rejected style imitation) | `anthropic/claude-haiku-4.5`, `bytedance-seed/seedream-5-0-pro` |
| assemble | Code builds the Sources section (links only; related posts are the blog page's own Read next block), creates the post `scheduled` + `needs_review` + agent-generated in category AI News, byline Metis, at the next free slot of 9:00, 15:00, 21:00 New York | none |

## Outcomes of a job

`succeeded` (a scheduled draft exists), `needs_attention` (a person must look: no primary source, unverified quotes, failed gates, slop verdict, missing setup), `failed` (the machinery gave up), `queued` and `running`. The Radar page shows one line per Kept story with the state and a link to the draft; reasons are in plain words ([[news-draft-runbook]]).

## Rules that matter

- **Fail closed.** No fetched primary source means no draft, in 12 seconds and $0. A quote that no source contains stops the job; it is never repaired by the code.
- **Nothing publishes itself.** The post is `scheduled` with `needs_review`; the publish cron withholds agent posts until Rob clicks **Approve** in the editor (green button under Curation tools). One click clears `needs_review`, which the publisher checks, and adds "Reviewed by <founder>" to the public byline and the Article schema; it also saves any edits on the page. The older buttons stay for other posts: **Mark reviewed** (clears the flag only, for human-written posts) and **Mark human-reviewed** (credit only, for an agent post that is already released). Verified in a browser on DEV 2026-11-02.
- **One job per story, one runner at a time.** `news_draft_job.candidate_id` is unique; the lease is a random token per run, so a replaced run cannot commit as its replacement. A job whose process died restarts from its first stage (steps are an audit trail, not a checkpoint).
- **Capped.** Three drafts per Melbourne day by default (`news_draft_config.dailyCap`), counted from each job's first start.
- **Untrusted text is fenced.** Everything from the web or from a model that read it goes into prompts inside random-marker fences (`lib/news-radar/draft/fence.ts`).
- **Logs carry counts and timings, never article or source text,** and error names, never messages.

## Threat model (OWASP pass, 2026-11-02)

| Surface | Risk | Guard | Test |
|---|---|---|---|
| The pages the pipeline fetches | SSRF into the server's network, huge or slow bodies, redirects to private hosts | `lib/news-radar/source.ts`: https only, public addresses only (checked at connect time, so DNS rebinding fails), redirects re-checked, size and time caps, a contact-bearing User-Agent | `source.test.ts` |
| Fetched text and model output in prompts | prompt injection from a hostile page | every web or model-derived value is fenced with a random per-call marker and the system prompt says fenced text is data; a placeholder inside an input is never expanded (single pass) | `skills.test.ts` (fencing, single-pass fill), `fence.test.ts` |
| The essay body | a model inserting links, scripts, a Sources section, an invented quote or number | deterministic gates reject links, bracket tags and any quote or figure no source holds; Sources is built by code from fetched URLs; the post is `needs_review` | `essay.test.ts`, `assemble.test.ts` |
| Who can start it | an unauthenticated caller spending money | only the admin label route and the `CRON_SECRET` cron route call `kickDrafting`; both are existing, gated routes; the switch is off unless set | label and cron route tests (401, 403 without Origin, 400 bad id) |
| Cost | a loop or a flood of Keeps | one job per story (unique index), one runner at a time (lease), a per-Melbourne-day cap, three rewrites and two brief corrections at most, a kill switch the drain re-reads before every story | `jobs.test.ts`, `start.test.ts` |
| Secrets | a key in a log or a row | the model key comes from the Integrations store; logs carry counts, timings and error names only; `attention_detail` is capped and never holds article or source text | `run.test.ts` |
| Publishing | a draft going live unreviewed | `scheduled` plus `needs_review`; the publish cron withholds agent posts until a person marks them reviewed | existing `process-scheduled-posts` tests |
| Privacy | executive answers or personal data | the pipeline reads public news only; the diagnostic's rules are untouched | none needed |

## Switches and settings

| Key (`site_setting`) | Meaning |
|---|---|
| `news_draft_enabled` | `{"enabled": true}`. **Absent means off.** The only thing that starts drafting |
| `news_draft_config` | optional overrides: `dailyCap`, `maxRewrites`, `targetWords`, `maxSources`, `maxAttempts`, `leaseMinutes`, `contactEmail`, `categorySlug`, `authorName`, `models` |
| `blog_publish_slots` | optional slot times; default 09:00, 15:00, 21:00 America/New_York |

## Files

`lib/news-radar/draft/` (`start`, `run`, `jobs`, `research`, `write`, `tighten`, `photo`, `assemble`, `essay`, `llm`, `skills`, `stage`, `wire`, `kick`, `background`, `seed-skills`, `config`), `lib/news-radar/source.ts`, `lib/posts-admin/publish-slots.ts`, `lib/news-radar/draft/fence.ts`, `drizzle/0043_news_draft.sql` (`news_draft_job`, `news_draft_step`), `scripts/seed-news-draft-skills.mts`, the draft line on the Radar page (`components/admin/radar/`, `lib/news-radar/queries.ts`).

## Verified (DEV, 2026-11-02, real models and network)

Five real Kept stories. The first run completed one and stopped four; three of those exposed real defects, which were fixed and re-run ([[2026-11-02-real-run-found-what-nine-hundred-tests-did-not]]). **Final state: four stories became scheduled drafts with images, and the fifth was refused correctly** (its real source, The Information, is paywalled, so no fetched document was primary: 12 seconds, $0, shown to Rob).

| Story | Time | Logged model cost |
|---|---|---|
| GMO cyberattack | 5 min 52 s | $0.71 |
| Anthropic $40T | 4 min 37 s | $0.59 |
| Qwen3.8 | 6 min 32 s | $0.82 |
| SK Hynix 2030 | 8 min 47 s | $1.04 |

The logged cost covers the text models; the Sonar search and the image (about $0.09) are not in it. The four posts took the four next free slots in order, every field limit held (SEO title at most 46, meta 150 to 160, 5 to 8 tags, about 950 to 1,030 words), and no bracket tag or placeholder was left in any body. Research on the three stories that failed first then passed 5 of 6 repeated runs; the sixth is why the brief now gets two corrections. The tighten stage passed 3 of 3 on the essay that had failed.

**Performance** (three jobs in a row, 20 minutes): peak memory 225 MB, event-loop delay at its 10 ms timer baseline (p99 11.4 ms, max 17 ms). A Keep over HTTP answered in 0.22 s and the draft ran after the response. The Radar page, held open through a run, updated each draft line in place with no reload (29 requests in 435 s, one per 15 s), with 0 accessibility violations at 375 and 1280 px.

## Not built yet

- Late-review behaviour: a draft reviewed after its slot has no rule (the publish cron would publish it on its next minute); moving it to the next free slot is open.
- The steelman skill mentions `{{raw_research}}` 13 times and every mention is filled with the whole research brief, so the thesis and steelman calls send 44k to 63k input tokens (about $0.15 each). His own skill runner (removed 2026-11-02, see [[2026-11-02-remove-skills-workflows-social]]) substituted every mention the same way, so this is how the skills were proved; changing it needs a quality comparison first.
- Nothing else is pending for PROD: it was activated 2026-11-02 ([[news-draft-runbook]]). The first real PROD jobs are the thing to watch.

## Where the prompts live now (2026-11-02)

The prompts are rows in the `skill` table, loaded by slug in `skills.ts`. The Skills pages that used to edit them were removed (see [[2026-11-02-remove-skills-workflows-social]]), so a prompt change is now a row edit in the database; the four rows are `archos-news-research-brief`, `archos-slop-judge`, `archos-editorial-photo` and `archos-ai-news-factcheck`. `scripts/seed-news-draft-skills.mts` still creates missing rows and never overwrites one. The input, output, version and execution tables of the old builder are dropped (migration 0044); `skill` itself stays.
