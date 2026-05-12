---
title: Diagnostic per-option scoring calibration (overview)
category: decision
created: 2026-05-09
updated: 2026-05-13
related: [[2026-05-08-phase2-ceo-review]], [[diagnostic-scoring-logic]]
---

Initial v1.0 calibration of the per-option scores for the AI Readiness Assessment. Recorded here as a meta-decision: *how the calibration was done* and *what it protects against*. The specific score changes themselves are not in this wiki — they live in the admin row at `site_setting` key `'diagnostic_content'`, with practitioner rationale captured inline next to each calibrated option.

Original spec encoding commit: `067f5b2` (2026-05-09). D-27 source relocation commit: `b69fb02` (2026-05-12). This wiki page was redacted to overview-only on 2026-05-13 as part of D-28; the original full content is recoverable from any commit before that date via `pnpm extract-content`.

## Calibration meta-discipline

The spec fixes the 0–3 scale (3 = strongest readiness signal, 0 = highest risk) and lists answer options in a deliberate order. First-pass per-option scores can be assigned by following option order. **Where the spec's stated intent and the option-order default diverge, the spec's intent wins** — and that deviation is recorded inline next to the option being changed.

Four such deviations were applied during initial v1.0 calibration. Each falls into one of four classes:

1. **Urgency masquerading as readiness.** A high-urgency answer that should not score full readiness credit because the urgency is the buyer's, not the foundation's. The score is reduced; the urgency signal is captured separately via the `PRIORITY_TRIGGERS` mechanism (see [[diagnostic-scoring-logic]]).
2. **Naive-confidence short-circuiting a confidence-test branch.** When a "no problem here" answer is scored at maximum, it short-circuits the follow-up branch designed to differentiate earned confidence from false confidence. The score is reduced so the branch can do its job.
3. **Theatre vs. partial credit.** Two adjacent options can read as similar in option order but be qualitatively different: one creates false confidence (documents without behaviour), the other has at least a policy layer to fall back on. Theatre scores at the floor; partial credit scores above it.
4. **Score-vs-trigger separation.** The same answer can drive both readiness contribution and CRM priority. Splitting these so the score reflects readiness only and the priority signal travels separately keeps the two concerns from tangling.

The four classes are the discipline; the specific (question, option, old score, new score) tuples live in the admin row.

## What was held

The user explicitly held the line on these against initial impulse:

- **Sector weighting** kept differentiated rather than flattened. Higher-stakes regulated sectors are genuinely higher-priority leads in this practice's positioning, and the score reflects that. Trade-off: a broken-foundation respondent in a high-weight sector can land one tier higher than the same respondent in a low-weight sector. Flagged as a "revisit after 50+ real submissions" trigger.
- **Pain-at-scale options** scored low across the board for the corresponding branch question. Every answer in that branch indicates pain; none signal readiness; the low domain contribution is correct.

## Why this matters

The 0–3 scale compounds across 12+ questions through three weighted domains into a 0–100 total. A single mis-calibrated option can shift the tier boundary for an entire respondent class. The four classes above specifically protect against:

- A high-urgency lead with a broken foundation incorrectly landing in the highest tier (soft CTA when an urgent CTA is warranted).
- Naive-confidence respondents bypassing the confidence-test branch.
- Governance theatre being scored equivalently to documented-but-unenforced governance.
- Urgency signal getting tangled in score calculation instead of travelling on the CRM payload.

Each class was caught by reading the engine's behaviour against the spec's stated intent — the spec is the load-bearing source of truth.

## Trigger to revisit

- **50+ real submissions.** Read tier distribution. If a respondent class consistently lands in a tier that doesn't match the practitioner read, retune the calibrated values.
- **Narrative drift.** If Claude's narrative consistently misfires the tone-by-tier rules, retune the system prompt before re-touching scores.
- **Spec version bump.** A new question or new option family triggers a fresh calibration pass; this decision document is for the v1.0 calibration only.

## Where the values are now

Live calibrated values: `/admin/diagnostic` → "Content JSON" textarea → field-by-field on each option.

Recovery of the original v1.0 calibration if ever needed: `pnpm extract-content <commit-before-2026-05-13>`.
