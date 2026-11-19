---
title: A fixed list of 12 photo subjects repeated; the cheaper model repeated a motif
category: synthesis
created: 2026-11-18
updated: 2026-11-18
related: [[news-draft-pipeline]], [[news-draft-runbook]], [[2026-11-02-real-run-found-what-nine-hundred-tests-did-not]]
---

## Problem

Readers said the AI News pictures were getting sloppy and repeating. I had assigned each post one of 12 hardcoded scenes by code, to stop the brief writer converging on a stopwatch. Reading the 26 published pictures side by side: 12 subjects, 11 of them used twice and the surveyor's tripod three times, plus one banned stopwatch runner. Every test passed throughout, because the tests checked that the rotation visited every scene, which it did.

## Fix

The subject now comes from the article. The writer is shown the alt texts of the last 30 pictures, and a brief whose subject repeats one is sent back with the matching picture named. The model moved from Haiku 4.5 to Sonnet 5.5 after both ran the real stage on 12 real articles: Haiku passed 5 first time and lost one picture, and its scenes shared one motif ("two identical things, one different"), which it copied from the list I showed it. Sonnet passed 10 first time and varied the scene, light and scale. Six Sonnet scenes rendered with the real image model looked distinct.

## Why

A fixed list is a promise to repeat: 3 posts a day on 12 scenes is a repeat every 4 days, and I counted the variety in the list, not in what a reader sees over weeks. And I measured the fix on the model I assumed was enough; the cheaper model met the letter of the new rule and kept the old sameness.

## Rule

- Judge variety by looking at the output over time (a contact sheet of everything published), not by counting the inputs that feed it.
- When the assigned variety is the fix for a model converging, check what the model does when left free; prompts that show it prior examples can make it copy their shape.
- Choose between two models by running both on the same real inputs and reading the results, then record the numbers. The user had pre-authorised Sonnet if Haiku did badly; the measurement is what justified spending the extra.
- A word-overlap check is tuned on real labelled data and says so in its comment (`shortcut:`); it will miss repeats in different words, so keep the prompt-side list too.
- Check a rollout order in both directions. I claimed the stored skill row could change before or after the deploy because old code tolerated the new template; I never checked new code against the old template, which fails every photo job (`buildPrompt` throws on a placeholder the code no longer supplies). The independent reviewer caught it. When a stored prompt and the code that fills it change together, the stored side goes first and the code must tolerate it.
