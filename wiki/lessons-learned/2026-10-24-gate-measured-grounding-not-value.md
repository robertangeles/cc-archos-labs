---
title: The slop gate measured grounding, not whether the post was worth publishing
category: synthesis
created: 2026-10-24
updated: 2026-10-24
related: [[blog-writer-agent]], [[2026-10-24-remove-ai-slop-posts]], [[2026-07-26-verify-by-running-not-by-deploying]]
---

## Problem

The agent published 254 posts in 90 days, unattended, and every one cleared the gate. None earned a Google impression, and an editorial read rated 206 of them below the bar for a consultancy brand.

## Why the gate passed them

- The grounding check ([lib/blog-agent/slop-check.ts](../../lib/blog-agent/slop-check.ts)) asks only whether a number appears *anywhere* in the research text. It never asks whether the source is relevant, current or fairly characterised, or whether the post says anything. It rewards stat density, which produces stat collages.
- The topic supply was one static Perplexity prompt per refill ([lib/blog-agent/plan.ts](../../lib/blog-agent/plan.ts)), so topics converged on the same few themes and the same famous statistics.
- The duplicate guard embedded the title alone and compared it with title + body vectors.
- The velocity ramp in PROD was `[21]`: full speed from day one, which the code comment says is the thing to avoid.
- Every defect that the prompt banned (em dashes, "not X but Y", `[Inference]`) shipped anyway. A prompt ban is not a gate.

## Rule

A gate that can only say "not fabricated" cannot protect a brand. Before an agent publishes without a human, it needs a check on *value*, measured against something external (traffic, an editorial read, uniqueness against the whole corpus), and a rollout that starts at a rate a human can read. "It passed every check we built" is a statement about the checks.
