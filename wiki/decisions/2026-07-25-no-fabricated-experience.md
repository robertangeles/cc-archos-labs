---
title: The blog agent may never invent lived experience
category: decision
created: 2026-07-25
updated: 2026-07-25
related: [[blog-writer-agent]], [[translation-layer]]
---

Agent-written posts must not contain first-person accounts of things that did not happen. Enforced by a hard-fail regex in the gate, not by a prompt instruction.

## What prompted it

The 2026-07-05 draft, produced by the *Archos Labs Blog* workflow and reviewed during planning, contained this:

> "I'll admit I spent three months convinced a clean policy document would be enough. I wrote it, sent it, and found out six weeks later that two people on the team had been feeding draft contracts into ChatGPT the entire time."

None of it happened. The byline on `/blog` is **Metis**, an AI persona (changed from "Rob Angeles" earlier the same week). So this is an AI inventing a personal history and publishing it as fact.

A first-pass scan put it at 1 of 7 drafts. Building the gate showed it was **3 of 7** — the auxiliary form ("I have watched organisations spend north of $2 million…") in two more drafts had been missed because the scan only looked for `I spent` / `I watched`. Intermittent enough that a human spot-check eventually waves it through, which is exactly why it needed a rule rather than vigilance.

## The decision

**Hard-forbid episodic first person.** Any account of a specific event the narrator experienced fails the gate outright and cannot be published.

First-person *reasoning* stays legal — "I'd start by auditing the three most important sources" carries no truth claim about the world and is a legitimate essay voice. The line is between reasoning and episodic memory.

## Why not just tell the model not to

Because a prompt instruction is a request and this is a correctness property. The gate is free, deterministic, and 100% reliable on a pattern; the model was already under instructions to be evidence-bound and produced the anecdote anyway.

## What it costs

First-hand experience is precisely the E-E-A-T signal Google rewards, and this removes it. That cost was accepted knowingly. The honest replacement is the **`field_note` slot** (deferred to PR 2): an optional per-item field where a real observation from actual client work is supplied by a human, and first person is permitted only where it traces back to that note. That is the one thing in this pipeline no model can generate.

## Alternatives rejected

- **Allow it as house style.** Rejected. Under an AI byline, invented war stories are the fastest way to lose the practitioner positioning the whole brand rests on, and they are unverifiable by definition — the core of the slop definition this pipeline was built against.
- **Let the judge catch it.** Rejected as the *only* control. The judge does also look for it, but it is stochastic and costs money; a regex is neither.
