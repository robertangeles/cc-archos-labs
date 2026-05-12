---
title: AI Readiness Assessment — Scoring Logic (overview)
category: concept
created: 2026-05-09
updated: 2026-05-13
related: [[2026-05-08-phase2-ceo-review]], [[2026-05-09-diagnostic-scoring-calls]], [[2026-05-08-minimal-admin-for-seo]]
---

Architectural overview of how the AI Readiness Assessment turns answers into a tier, risk flags, and a CRM priority signal. **Specific per-option scores, question wording, and calibration values are not in source or in this wiki — they live in the admin row (`site_setting` key `'diagnostic_content'`, edited via `/admin/diagnostic`).** This page describes the *engine*, not the *content*.

## Pipeline

```
answers
  ├─→ scoreSession()           → SessionScore (per-domain + total 0–100)
  ├─→ deriveTier()             → TierBoundary
  ├─→ evaluateRiskFlags()      → RiskFlag[] (severity-sorted, capped)
  └─→ evaluatePriorityTriggers() → { isPriority, reasons[] }

bundled by evaluateSession() → SessionResult
```

Every step is a pure function of `(answers, content)`. The diagnostic engine carries no state; the admin row supplies the calibrated values; the report and CRM payload consume the result.

## Concepts

### Per-option scoring (0–3 scale)

Each answer option carries an integer score. **3 = strongest readiness signal, 0 = highest risk.** The engine sums the chosen option's score per domain, then normalises against the maximum possible for that domain *given which questions the respondent was actually asked* (branching changes the denominator per-session).

### Branch resolution

Some questions are conditional follow-ups; some questions are *replaced* (not inserted) based on an earlier answer. `lib/diagnostic/flow.ts` resolves the per-session question list before scoring runs. Two mechanisms exist:

- **Insertion** — a branch question is asked after its parent when a specific answer fires.
- **Replacement** — a base question is swapped for a branch variant entirely; the base is not asked and its dependent inserts are also skipped.

The flow logic knows about specific question IDs structurally (which IDs branch to which); the calibrated answer-to-branch mappings travel with the content.

### Domain weighting

Three domains are scored independently and combined with weights into the 0–100 total. The weights live in the admin row and are configurable per CEO-review decision.

### Tier derivation

Score range → tier label. Boundaries live in the admin row. `deriveTier(score, content)` walks the boundaries in order and returns the first matching range; defensive fallback to the lowest tier if a score lands outside the configured range.

### Risk flags

Pattern-match against answer combinations. Each rule is `{ code, title, body, severity, trigger }`; severity-sorted and capped at three per session per spec. Codes are stable across calibration revisions so historical reports stay readable.

### Priority triggers

Independent of the readiness score. Some answers warrant immediate sales follow-up regardless of how mature the organisation actually is — urgency on the buyer side, separate from readiness on the org side. The trigger list lives alongside the questions in the admin row; the scoring engine sets `lead.is_priority = true` on match.

## Where the actual values live

- **Calibrated content** (questions, options, scores, risk-flag rules, priority triggers, tier boundaries, domain weights) — `site_setting` row keyed `'diagnostic_content'`, edited via `/admin/diagnostic`. Loaded server-side per request via `getDiagnosticContent()` in `lib/diagnostic/content-config.ts`.
- **Engine code** — `lib/diagnostic/{scoring,flow,prompts,content-config-shared,content-config}.ts`. Pure functions, no IP-sensitive values.
- **Calibration rationale** — recorded inline in the admin row as practitioner comments at edit time; older rationale is preserved in git history before D-27 relocation (commit `b69fb02`) and accessible via `pnpm extract-content <commit>`.
- **Per-session results** — `assessment_session.scores`, `assessment_session.tier`, `assessment_session.risk_flags` columns; `report_output` carries the Claude narrative + version metadata.

## Engine implementation surface

| File | Responsibility |
|---|---|
| `lib/diagnostic/types.ts` | Type model for Question, AnswerOption, Domain, Tier, RiskFlag etc. |
| `lib/diagnostic/content-config-shared.ts` | Zod schema + placeholder fallback. |
| `lib/diagnostic/content-config.ts` | Server-only loader (DB row → DiagnosticContent). |
| `lib/diagnostic/flow.ts` | Branch + replacement resolver (computeFlow, getNextQuestionId, getProgress). |
| `lib/diagnostic/scoring.ts` | scoreSession, deriveTier, evaluateRiskFlags, evaluatePriorityTriggers, evaluateSession. |
| `lib/diagnostic/prompts.ts` | buildUserPrompt — composes the per-session Claude message. |

## Calibration discipline

The spec fixes the 0–3 scale and the domain shape. Specific per-option scores are calibrated against the spec's stated intent at content-creation time; deviations from the option-order default are documented inline in the admin row at the option being changed, so a future reader sees *why* the score is what it is next to the data. See [[2026-05-09-diagnostic-scoring-calls]] for the meta-discipline applied during initial v1.0 calibration.

## When to revisit

- After enough real submissions to read tier distribution honestly: if a respondent class consistently lands in a tier that doesn't match the practitioner's read, retune the calibrated values in the admin row.
- If the Claude narrative misfires the tone-by-tier rules: retune the system prompt before re-touching scores.
- If a new question is added to the spec: the engine accepts it via the next admin edit; no code change unless the question introduces new branch semantics.
