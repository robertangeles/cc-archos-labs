---
title: News radar rubric approved: pick stories for the Behind the AI Headline method
category: decision
created: 2026-10-27
updated: 2026-10-27
related: [[news-radar]], [[news-radar-runbook]], [[2026-10-26-news-radar-design-amendments-confirmed]], [[2026-10-27-write-the-rubric-from-the-owners-own-method]]
---

## Decision

Rob approved the rubric wording and cut-offs on 2026-10-27. The radar picks a story when it would make a strong **Behind the AI Headline** breakdown, his YouTube channel's method: go to the primary source (the study, court filing, earnings report or government data), show what the headline left out (who pays, what it assumes, where experts disagree), then give a verdict. A story fits when its headline rests on a specific checkable claim in a major AI story (a big lab or company, data centers, AI money, jobs, safety, regulation). Product launches, benchmark rankings, hires and exits, opinion and rumour fit poorly.

The full file, ready for `scripts/radar-rubric-set.mjs`, is the example in [[news-radar-runbook]]. Cut-offs: audience fit (relevance) at least 2 of 3, confidence at least 0.5, novelty distance at least 0.3, three items shown per day (display only).

## Evidence

On 2026-10-27 the 33 items already on DEV were scored with the real Jev model (`jev-1.14.0`), nothing written, against this wording:

- 10 of 33 are eligible (30%). The feed carries about 14 items a day, so about 4 eligible a day.
- The top of the list is the money and infrastructure stories with a number to check: Apollo's "zero financial payoff" report, data-center penalty clauses, the UK sovereign AI fund, Nvidia GPU rental prices, Bloom Energy's 5 GW target, SpaceX's $40B debt raise. Breach stories (LiteLLM, OpenCode) drop because they carry no statistic to check; the typhoon story scores 0.
- Novelty at 0.3, not 0.4, keeps the Apollo story (distance 0.35 from Rob's existing ROI posts), the best fit in the set.

## What this implies

- **The gate takes about 12 days, not 7.** 7 valid days is a minimum. At about 4 eligible a day, 50 labelled items needs about 12. Loosening relevance to 1.5 would reach 50 in a week but lets in noise. Rob approved the file; the longer window follows from the numbers and was not discussed separately.
- **Two AI-regulation stories sit just under the confidence cut-off** (Sweden's government ban, 0.45; the US official's accusation against Anthropic, 0.40). Lowering confidence to 0.4 would admit them and weaker items too.

## Caveats

- The sample is 33 items, and the cut-offs were chosen from the same items. The evaluation window is the real test.
- The channel's verdicts (true, half true, unproven, overblown, false) are not part of this rubric. It only picks stories; verdicts belong to Release 2 drafting.
- The plan aimed blog rankings at regulated-industry data and AI long-tail queries. This rubric does not screen for that. Whether it should still tilt the choice is open.
- The key is still called `audience_fit` because `lib/news-radar/rubric.ts` requires that name. It now means fit for the channel's method.

## State

DEV holds version 2 (created 2026-10-27). Version 1, the old regulated-industry wording, stays as an unused warm-up row; scores are evidence and are never deleted. PROD has no radar tables yet, so no PROD version exists. The evaluation cohort starts when the evaluation version is created on PROD after the page is live, monitoring is verified and the claim smoke is done ([[news-radar-runbook]]). Any later change to wording, model or cut-offs is a new version and restarts the window.
