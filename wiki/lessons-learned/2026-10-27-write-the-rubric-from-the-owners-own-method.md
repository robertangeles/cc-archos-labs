---
title: I drafted the news rubric for the wrong reader and tested it before checking the premise
category: synthesis
created: 2026-10-27
updated: 2026-10-27
related: [[2026-10-27-news-radar-rubric-v2-approved]], [[news-radar]], [[news-radar-runbook]]
---

## Problem

Asked to propose the news radar's rubric, I wrote a question for "a senior data or AI leader running a program in financial services, healthcare or government" and tested it against 33 real items with the real Jev model, then proposed cut-offs from the results. Rob's reply: "Your question does not make sense, we are sharing news and create our commentary. We dissect the news and really analyse all its sources, like how we do in our YouTube channel, Behind the AI Headline." The question, the test and the cut-offs were all built on the wrong reader.

## Why

Confirmed: the audience came from the CEO plan's rubric line (E4: "audience fit for regulated-industry data/AI programs"), which was marked "wording still needs Rob's approval". I treated an unapproved line as the brief. Confirmed: Rob's channel method was written nowhere in the repo, the plan or memory, so reading the project would not have corrected it.

[Inference] A short premise check would have caught it in one message, before the 33 Jev calls. The first trial measured how well the wrong question was answered, so none of its numbers carried over to the new wording.

## Rule

When a prompt, rubric or filter is about the owner's editorial judgment, say the premise in one line first ("a story is picked when ...") and get it confirmed, before any tested draft or paid scoring run. A plan line marked as needing approval is a hypothesis, not the brief. Save the owner's description of their own method once they give it (the channel description is in memory), so the next draft starts from it.
