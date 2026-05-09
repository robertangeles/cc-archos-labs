---
title: Diagnostic per-option scoring calibration calls
category: decision
created: 2026-05-09
updated: 2026-05-09
related: [[2026-05-08-phase2-ceo-review]], [[diagnostic-scoring-logic]]
---

Four per-option score calibration changes applied to `lib/diagnostic/content.ts` after the v1.0 spec encoding. The spec §5.1 fixes the 0–3 scale (3 = strongest readiness signal, 0 = highest risk) but does not enumerate every per-option score; first-pass values were assigned by following the spec's option-order conventions. These four changes deviate from the default ordering with explicit rationale.

Each changed option carries an inline comment in `content.ts` capturing the same rationale next to the data, so a future reader sees *why* the score is what it is without having to dig out this decision file.

Commit: `067f5b2` (2026-05-09).

## The four changes

### Q3 D — "We are scaling AI but hitting unexpected walls"

**Score: 3 → 1**

Q3 maps to the Program Readiness domain. The spec calls "scaling, hitting walls" the highest-urgency lead signal — but urgency is not readiness. An organisation hitting walls at scale has a broken foundation surfaced at scale, not a healthy program. Scoring this answer 3 would land respondents in Advanced tier (Scale-Ready) with a soft CTA — the wrong message to send to your best prospect. Score 1 keeps the *option* present and lets it contribute meaningfully, but stops it from masquerading as readiness.

Persona C (mature tech co with strong Data Foundation answers and Q3=D) lands in Advanced tier at 88 total — the calibration doesn't penalise programs that are *actually* mature and just hitting growth-curve walls. Persona B-style respondents (broken foundation + Q3=D) would correctly land lower because their Data Foundation answers carry the weight.

### Q6 D — "No, data has not been an issue for us"

**Score: 3 → 2**

Q6 asks whether data quality has ever delayed or killed an AI initiative. The "No" answer triggers Q6b — a confidence-test branch question that asks whether their data infrastructure has been formally assessed for AI workloads (not just analytics). The spec's intent is clear: Q6b exists *because* naive confidence on Q6 is a red flag. Scoring Q6=D as 3 short-circuits the entire branch's purpose by giving the respondent full credit before Q6b has a chance to differentiate earned confidence (Q6b=A: assessed for AI in last 12 months) from false confidence (Q6b=D: assumed ready based on analytics capability).

Q6=D scoring 2 lets Q6b do its job. A respondent who answers Q6=D + Q6b=D contributes 2 + 0 = 2 to Data Foundation. A respondent who answers Q6=D + Q6b=A contributes 2 + 3 = 5. The differentiation lives in the right place.

### Q8 C — "Aspirational — we have the documents but not the behaviour"

**Score: 1 → 0**

Q8 distinguishes governance theatre from governance with teeth. The spec's option ordering puts Active (A) at the top scoring 3 and "no formal governance function" (D) at the bottom scoring 0. Documented (B) and Aspirational (C) sit in the middle. First-pass calibration scored both at 1 — they read as similar pseudo-governance.

But "documents without behaviour" (Aspirational) is qualitatively worse than "policies exist but rarely enforced" (Documented). Aspirational governance creates *false confidence* — leadership reads the docs and believes the program is governed, while operationally nothing changes. Documented governance at least has the policy layer to refer to when an incident forces enforcement; Aspirational has nothing.

Score Aspirational at 0 to mark it as a real risk signal. Documented stays at 1 as the partial-credit middle.

### Q12 B — "Board or regulatory mandate — we have been directed to act"

**Score: 3 → 2**

Q12 maps to Org Reality and serves dual roles: scoring contribution + lead-priority signal. The first-pass calibration scored Q12=B at 3 because "board mandate" is the highest-urgency answer per spec intent. But scoring is meant to measure *readiness*, not urgency — a board mandate creates timeline pressure on the buyer regardless of how ready the organisation actually is.

Solution: score Q12=B at 2 (same as the other "real urgency" options A and C) and capture the lead-priority signal separately via the new `PRIORITY_TRIGGERS` data structure introduced in the same commit. The scoring engine reads `PRIORITY_TRIGGERS` and sets `lead.is_priority = true` on the CRM webhook independently of the readiness score and tier. Persona A (Q12=B with mid-maturity profile) demonstrates the orthogonal split working correctly: Developing tier (mid readiness) + priority TRUE (board pressure → fast follow-up).

## What was *not* changed

The user explicitly held the line on these against initial impulse:

- **Q1 sector scores** (FS=3, HC=3, Gov=2, Energy=2, Other=1): kept the weighted approach. Higher-stakes regulated sectors are genuinely higher-priority leads; the score reflects that. The fact that this lets Persona B's "FS CDO with 0% Data Foundation" land in Emerging not Critical is documented in [[diagnostic-scoring-logic]] and flagged as a "revisit after 50+ real submissions" trigger.
- **Q9b option scores** (range 0–1): every Q9b answer indicates pain at scale; the low domain contribution is correct because none of these answers signal readiness.

## Why this matters

The four-option scale (0–3) compounds across 12+ questions through three weighted domains into a 0–100 total. A single mis-calibrated option can shift the tier boundary for an entire respondent class. These four changes specifically protect against:

1. **Q3=D**: a high-urgency lead with a broken foundation incorrectly landing in Advanced (soft CTA when an urgent CTA is warranted).
2. **Q6=D**: naive-confidence respondents bypassing the Q6b confidence test.
3. **Q8=C**: governance theatre being scored equivalently to documented-but-unenforced governance.
4. **Q12=B**: urgency masquerading as readiness; CRM priority signal getting tangled in score calculation.

Each was caught by reading the engine's behaviour against the spec's stated intent — the spec is the load-bearing source of truth, and where the spec's intent and the default option-order calibration diverged, the spec's intent wins. The persona test results in [[diagnostic-scoring-logic]] confirm the calibration produces sensible tier assignments across the three respondent archetypes the assessment is built for.

## Trigger to revisit

- 50+ real submissions: read tier distribution. If Critical tier is empty (Persona B-style respondents always landing in Emerging), revisit Q1 sector weighting or Data Foundation domain weight.
- Claude narrative consistently misfires the tone-by-tier rules: retune system prompt before re-touching scores.
- New question added to spec v1.1+: this decision document is for the v1.0 calibration only; subsequent tuning gets its own dated decision.
