---
title: News draft pipeline design: what Rob decided and what was assumed
category: decision
created: 2026-11-02
updated: 2026-11-02
related: [[news-draft-pipeline]], [[news-draft-runbook]], [[news-radar]], [[2026-10-27-news-radar-rubric-v2-approved]]
---

## Decision

Pressing Keep on the Radar starts a background job that researches the story against its primary source, writes a Behind the AI Headline fact-check, tightens it with a slop judge, photographs it and leaves a **scheduled, needs-review** draft. Rob reads and approves every post; nothing publishes until he clicks the editor's **Approve** button, which clears `needs_review` and adds the "Reviewed by" byline credit in one click. (An earlier version of this page named "Mark human-reviewed" as the release by mistake; that button only adds the credit.)

## Decided by Rob (2026-11-02, this build session)

- **Three posts a day**, at 9:00, 15:00 and 21:00 **New York** time (his words: "new your time zone"). A new draft takes the next free slot.
- **One skill per job.** News posts use `archos-ai-news-factcheck`, forked from his Paul Graham essay skill; the essay skill stays as it is, with its own image skill.
- **Realistic photos**, not imitated illustration styles (he found the Schmitz-style images ugly). Seedream 5.0 Pro.
- **His slop judge is an editor.** The DeepSeek v4 Flash 0731 review, with its "What to tighten" notes, feeds the writer for another pass.
- **Sources is a links-only section built by code.** The "every direct quotation above was checked" sentence was removed ("so amateur").
- **SEC contact for fetching filings:** `rob.angeles@archoslabs.xyz`.
- AI News is the category; the byline is Metis.
- **One click to approve** (2026-11-02): an agent draft that needs review gets a single **Approve** button that releases it and adds the public "Reviewed by <founder>" credit together. The columns stay separate in the code (`needs_review`, `reviewed_by_human_at`); only the button combines them.
- **A Keep starts the entire process** (confirmed 2026-11-02: "Yes Keep should start the entire process"). The cap of 3 drafts per Melbourne day is the 3 posts a day he asked for, kept as `news_draft_config.dailyCap`; the on/off switch is `news_draft_enabled`.

## Assumed, not confirmed

- **Late review.** A draft he reviews after its slot has no rule yet; the publish cron would publish it the next minute. Moving it to the next free slot is the likely answer and is not built.

## Why these choices

- **Background, not a request.** Cloudflare fronts the site and a draft takes about six minutes, so the work runs after the response (`after()`), claimed through a job table with a lease, and the Radar page polls for its state.
- **Fail closed.** The failure the search-model-only version showed was an invented quote and a URL that returned 404. The code now fetches the pages itself and checks every quotation against the text; a story without a fetched primary source is stopped for a person.
- **Gates are code, taste is a model.** Quotes, numbers, the verdict word, links and field lengths are checked deterministically; the slop judge only advises.
- **The SEO position is honest.** 254 earlier agent posts earned no impressions. Google's scaled-content policy targets purpose, not tooling, and this pipeline's purpose is checked claims against primary sources, reviewed by a person, three a day at most.
