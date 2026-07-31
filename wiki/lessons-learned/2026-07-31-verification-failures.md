---
title: Five ways a check passed while proving nothing
category: synthesis
created: 2026-07-31
updated: 2026-07-31
related: [[2026-07-31-corpus-taxonomy-and-cdmp-pool]], [[2026-07-31-audience-scoped-source-disclosure]]
---

Every one of these produced a green result that meant nothing. Recorded because
the failure mode is identical each time: **the check ran, the check passed, and
the check was not measuring what it claimed to.**

---

## 1. A measurement that failed to a plausible value

**Problem.** The first prompt A/B run reported 0/8 on every metric. It read as a
clean, if surprising, finding — the new prompt changed nothing.

It was a judge parse failure. `openrouter()` returned `""` on an empty
completion, `JSON.parse("")` threw, and the catch block substituted zeros. Eight
questions, two arms, sixteen silent zeros, presented as an aggregate.

**Fix.** Throw on an empty completion and report `finish_reason`. On a parse
failure, keep the raw text rather than scoring 0.

**Rule.** A measurement must never fail to a value that is indistinguishable
from a real result. Zero is a legitimate answer; make "I could not tell" a
different one.

---

## 2. An A/B whose control moved more than its treatment

**Problem.** After rewording a prompt bullet, the client arm's tension score went
from 7/10 to 6/10 — apparently a regression. But the OLD arm, an unchanged
control on identical inputs, moved 4/10 → 8/10 between the same two runs.

The instrument's run-to-run noise was larger than the effect being measured. The
"regression" was nothing.

**Attempted fix.** `temperature: 0` on both generation and judging.

**It did not work.** Two runs of the identical control arm at temperature 0
scored 2/10 and 6/10. Temperature 0 does not make an LLM judge reproducible in
practice — and via a router, consecutive runs may not even hit the same provider
or quantisation.

**Outcome.** The large effects (internal arm: 0.00 -> 2.00 works named, 0/10 ->
9/10 separates-judgement) are far outside the ±4 band and stand. The small one
(client-arm tension, +1 to +2) is inside it and is recorded as UNPROVEN rather
than banked from the favourable run.

**Rule.** Before believing a delta, run the control twice. A control that moves
more than your treatment means the experiment cannot answer the question — and
the temptation at that point is to quote the run that agreed with you.

---

## 3. A test that failed for a different reason than the one being tested

**Problem.** A drift guard compared a runtime string to source text line by line.
Mutating one word in the source made it fail — but it flagged a *different* line
than the mutated one. The runtime string is built by concatenation
(`"...excerpt " + "is labelled..."`), so no runtime line ever appears
contiguously in the source; it failed on line 1 regardless of drift.

A second version normalised whitespace and quotes but not backslashes. The
source escapes its inner quotes (`\"Block's point\"`) while the runtime string
carries them bare, so it failed *while in sync* — which reads as "the code is
broken" rather than "the test is broken".

**Fix.** Normalise both sides to significant characters (drop `\n` sequences
first, then backslashes, quotes, `+` joins, whitespace).

**Rule.** Verify an assertion in BOTH directions: it passes when correct AND
fails when you deliberately break the thing it guards. If a mutation test flags
something other than what you mutated, the assertion is firing for the wrong
reason.

---

## 4. `git add -A` silently skipping an ignored file

**Problem.** `scripts/_metis-source-blocks.mjs` was never committed across three
commits. `.gitignore:24` carries `/scripts/_*.mjs`, and `git add -A` skips
ignored paths without a word. Two committed scripts imported it, so neither
could run from a fresh clone. CI did not catch it because CI does not execute
`scripts/` — only a unit test's file read did, and only after that test stopped
importing the module and started reading it from disk.

**Fix.** Renamed out of the ignore pattern. The underscore convention marks
local scratch; this was shared code.

**Rule.** `git status` being clean does not mean your new file is tracked. Check
`git ls-files <path>` after adding anything new.

---

## 5. A CI-green change that had never been type-checked

**Problem.** A test importing a module under `scripts/` passed locally under
vitest and failed CI with `TS2307`. `tsconfig.json` excludes `scripts/**/*`;
vitest resolves at runtime, `tsc --noEmit` does not. It passed locally only
because vitest had been run on that file and `tsc` had not.

**Rule.** Run the same gates CI runs — `tsc`, `lint`, `test` — not just the one
covering the file you touched. Reading a script as text is also strictly better
than importing it: it survives a module-format change and has no tsconfig
dependency.

---

## The shape they share

A test asserts a property. It is easy to write one that asserts a *different*
property, or none, and impossible to notice from a green tick. The only reliable
antidote used here was **mutation**: break the thing on purpose and confirm the
guard notices. Every guard in this session's work that survived mutation testing
was sound; two that had not been mutation-tested were quietly wrong.
