---
title: AI Readiness Assessment — scoring calibration v1.1 + spec bump
category: decision
created: 2026-05-17
updated: 2026-05-17
related: [[2026-05-09-diagnostic-scoring-calls]], [[diagnostic-scoring-logic]]
---

Five-change retune of the AI Readiness Assessment ahead of go-live. Three score corrections (the four-classes meta-discipline applied), one spec bump (new question Q12a), and one removal-from-scoring (Q1 sector becomes a captured lead attribute, not a readiness signal). Source-of-truth for the JSON moved out of the admin textarea and into a committed `scripts/diagnostic-content.json` + `scripts/seed-diagnostic-content.mjs` upsert.

## The five changes

| Change | Class (per [[2026-05-09-diagnostic-scoring-calls]]) |
|---|---|
| Q9a "data not in a state to support AI" A: 3 → 0 | Class 1 — urgency/self-awareness masquerading as readiness; admitting broken data is the worst readiness signal, not the best |
| Q3 "where are you with AI" C ↔ D swap (scaling-with-walls > stuck-in-prod) | Class 3 — partial credit; scaling indicates further-along maturity than stalled-in-prod |
| Q6 "data quality killed an initiative" D: 2 → 1 (below C=2 "aware of risk") | Class 2 — naive-confidence; "no problem here" should not score above demonstrated awareness |
| New Q12a "has budget been formally allocated" + priority trigger on A | Class 4 — score-vs-trigger separation; budget approved is its own outreach-priority signal |
| Q1 sector — all option scores set to 0 | Spec evolution; sector becomes lead-data only (used for call prep + Claude prompt context), not a readiness signal |

## Why the source-of-truth moved

The 2026-05-09 calibration recorded values lived only in the admin textarea. Auditable but not diffable. For this round:

- `scripts/diagnostic-content.json` is the version-controlled canonical content.
- `scripts/seed-diagnostic-content.mjs` upserts it into `site_setting` key `'diagnostic_content'` (Zod validation still happens at the admin loader + runtime loader; the script is a thin apply step).
- The `/admin/diagnostic` textarea remains usable for live tweaks but the script + JSON is the durable record. Future calibration changes should update the JSON and re-run the seeder so the wiki, git history, and DB stay in sync.

A timestamped pre-change snapshot of the prior DB row was kept locally in `tmp/diagnostic-content.backup-*.json` (gitignored) for rollback safety.

## Code change required for Q12a

`computeFlow` in [lib/diagnostic/flow.ts](../../lib/diagnostic/flow.ts) has a hardcoded base order — adding a top-level question to the JSON does not make it appear. Q12a was appended to `BASE_ORDER` and to the Block 3 push in `computeFlow`. No engine changes; scoring stays content-driven.

## Spec status

The v1.0 spec used at initial calibration treated Q1 as a scored sector signal and did not include Q12a. This decision document supersedes the v1.0 score table for Q1, Q3, Q6, and Q9a, and adds Q12a + its priority trigger as v1.1 spec deltas.

## Trigger to revisit

Same as the 2026-05-09 page: 50+ real submissions, narrative drift, or a further spec bump.
