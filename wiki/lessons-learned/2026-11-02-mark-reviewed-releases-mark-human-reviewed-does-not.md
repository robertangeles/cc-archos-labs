---
title: I told Rob to click Mark human-reviewed; the button that releases a draft is Mark reviewed
category: synthesis
created: 2026-11-02
updated: 2026-11-02
related: [[news-draft-pipeline]], [[news-draft-runbook]], [[2026-11-02-real-run-found-what-nine-hundred-tests-did-not]]
---

## Problem

The wiki, the PR description and my messages said the publish cron withholds a pipeline draft "until Rob clicks Mark human-reviewed". Rob clicked it on the GMO draft on DEV and the posts list still said "needs review". He was right: the editor has two review buttons under Curation tools, and they do different things.

- **Mark reviewed** (amber, shown while `needs_review` is set): PUT with `needsReview: false`. This is the flag the scheduled publisher checks (`NOT (is_agent_generated AND needs_review)`), so it is the release.
- **Mark human-reviewed** (green, agent posts only): stamps `reviewed_by_human_at`, which adds "Reviewed by <founder>" to the public byline and the Article schema. It leaves `needs_review` alone. A code comment says "Do not merge the two."

The pipeline itself was right (drafts are created `needs_review = true` and stay withheld). The instruction I gave was wrong, and I had not clicked either button before writing it. Had it gone unnoticed, a PROD draft marked only "human-reviewed" would have sat unpublished with nothing to say why.

## Fix

Corrected the entity page, the design decision and the runbook (step 8 and the Radar-line table). Checked the real flow in a headless browser on a DEV draft: Mark reviewed clears the flag, keeps the schedule and removes the badge from the list; the byline credit stays unset. The draft was then restored exactly. Rob then chose one click for these drafts, so the editor now shows a single **Approve** button (clears the flag and adds the credit) on an agent draft that needs review.

## Rule

- **Before telling the owner which button to press, press it** (or read the handler and the predicate it feeds) and say what the other buttons on the screen do. I read the publisher comment that names "Mark reviewed" and still wrote the other name from memory of the feature's goal.
- **A gate described in a doc must name the exact control and the exact column it changes.** "Reviewed" is two things in this codebase.
- **The review step is part of the pipeline's definition of done:** run it once end to end on DEV, from the Radar line to the post leaving the badge list, before calling the pipeline finished.
