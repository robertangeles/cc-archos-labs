---
title: Verify by running the thing, not by verifying the deploy
category: synthesis
created: 2026-07-26
updated: 2026-07-26
related: [[blog-writer-agent]], [[blog-writer-agent-runbook]], [[deployment-architecture]]
---

Three defects survived a careful PROD promotion because every check confirmed the parts were present, and none confirmed the whole thing produced a post.

## Problem

The blog agent was promoted to PROD on 2026-07-26 with a full checklist: `pg_dump` backup, migration `0036` applied by hand, PR through CI, deploy verified live on the merge commit, seeds re-run, config enabled, Render cron created. Every step passed.

The agent could not produce a single post. Three separate defects, none visible from outside:

1. **The queue could never refill.** `researchLandscape` passed `AbortSignal.timeout(180s)` straight to `fetch`, so the signal stayed armed during `res.json()`. `sonar-deep-research` answers its headers in ~10s and streams the body for minutes — measured: `HTTP 200 after 10s`, then `TimeoutError`. Our own timer killed a call that had succeeded, and the `catch` reported it as `"research returned nothing"`, which reads like the provider misbehaving.

2. **The gate rejected everything.** The research returns narrative prose with `[1][2]` markers and zero figures — 7 runs sampled across DEV and PROD, not one percentage. The essay skill is told to be specific, so it invented figures. The grounding gate refused them. Correctly.

3. **A hole in the highest-severity check.** `"I have never seen a founder regret building this setup"` reached PROD under the Metis byline, which is not a person. `saw` was in the verb list; `seen` was not.

Then two more, downstream of the first three: a parked draft ended the tick, so at the observed rejection rate three cron ticks a day delivered well under three posts — silently, since every part returned success. And the cron 401'd because the service was created via API outside the account's environment.

## Fix

Ran the pipeline directly against PROD — the same `runOnce()` the cron route wraps, invoked from a script with PROD's `DATABASE_URL` passed inline. Every defect surfaced within three runs. All are fixed in PR #217 plus the essay-prompt patch.

## Rules

**Verifying a deploy is not verifying a feature.** "Live on the right commit, table present, config seeded, cron created" is a statement about parts. The only check that counts is the artefact the feature exists to produce. If the pipeline is supposed to write a post, the check is a post.

**Auth on an endpoint is not auth on the function.** Two hours went into the cron's 401 before noticing the route was a thin wrapper around a plain library call. The bearer token protects the HTTP surface; it was never a gate on running the code. When blocked on infrastructure, ask whether the thing behind it can be invoked directly.

**When a gate rejects everything, suspect the supply, not the filter.** The instinct is to loosen the threshold. Here that would have shipped invented statistics under an AI byline — precisely the failure the gate exists to prevent. Grounded figures went 0/4 → 3/4 → four consecutive first-attempt passes by fixing what the writer was given, not what it was checked against. This is the design thesis restated: slop is a supply problem before it is a filter problem.

**A model given freedom converges; a model given an example follows the example.** Learned four times on this feature — settings collapsed to "warehouse", objects to "a ruler", elements to "three doors", and figures to invention. Every one was fixed by moving the choice out of the model and into deterministic code or an explicit rule.

**A human in the loop is a filter you cannot ship.** Manual runs looked fine because a human re-ran until the output was good. That filter disappears the moment the thing runs unattended, and its absence is invisible in every manual test.

**Prompts tuned in a live UI drift between environments.** `archos-paul-graham-essays` was 2,655 characters longer in PROD than DEV. Anything validated in DEV was validated against a prompt PROD does not run. Compare `md5(prompt_template)` across environments before trusting a DEV result.

**Zero is a suspicious number.** "0% of 4 checkable paragraphs trace to the research" looked like a broken check, and checking that intuition was right to do — but the evidence said the check was correct and the input was empty. Follow the number to the data either way; do not act on the intuition alone.
