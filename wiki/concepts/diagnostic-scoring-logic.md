---
title: AI Readiness Assessment — Scoring Logic
category: concept
created: 2026-05-09
updated: 2026-05-09
related: [[2026-05-08-phase2-ceo-review]], [[2026-05-09-diagnostic-scoring-calls]], [[2026-05-08-minimal-admin-for-seo]]
---

How the AI Readiness Assessment scores answers, derives a tier, fires risk flags, and tags priority leads. Source of truth in code: `lib/diagnostic/content.ts` + `lib/diagnostic/scoring.ts`.

## Scoring matrix

Every option carries an integer score on the 0–3 scale per spec §5.1. **3 = strongest readiness signal, 0 = highest risk.** The engine sums the chosen option's score per domain, then divides by the maximum possible for that domain *given which questions were asked* (branches change which questions appear, so the denominator is per-session, not static).

### Per-question option scores

| Q | Domain | Block | A | B | C | D | E |
|---|---|---|---|---|---|---|---|
| Q1 sector | Org Reality | 1 | 3 (FS) | 3 (HC) | 2 (Gov) | 2 (Energy) | 1 (Other) |
| Q2 role | Org Reality | 1 | 3 | 2 | 1 | 0 | — |
| Q3 maturity | Program Readiness | 1 | 0 | 1 | 2 | **1** ← *not 3, see [[2026-05-09-diagnostic-scoring-calls]]* | — |
| Q4 lineage | Data Foundation | 2 | 3 | 2 | 1 | 0 | — |
| Q5 sources of truth | Data Foundation | 2 | 3 | 2 | 1 | 0 | — |
| Q6 prior data failure | Data Foundation | 2 | 0 | 1 | 2 | **2** ← *not 3* | — |
| Q6a was issue known? | Data Foundation | 2 | 1 | 2 | 0 | 0 | — |
| Q6b infra assessed for AI? | Data Foundation | 2 | 3 | 1 | 2 | 0 | — |
| Q7 explainability | Data Foundation | 2 | 3 | 2 | 1 | 0 | — |
| Q8 governance in practice | Data Foundation | 2 | 3 | 1 | **0** ← *not 1* | 0 | — |
| Q9 last initiative outcome | Data Foundation | 2 | 3 | 1 | 0 | 0 | — |
| Q9a barrier (replaces Q9 if Q3∈A,B) | Data Foundation | 2 | 3 | 1 | 1 | 1 | 0 |
| Q9b walls (replaces Q9 if Q3=D) | Data Foundation | 2 | 0 | 0 | 1 | 1 | 0 |
| Q9c shelving reason (after Q9=C) | Data Foundation | 2 | 1 | 1 | 1 | 1 | 0 |
| Q9d production reality (after Q9=A) | Data Foundation | 2 | 3 | 2 | 1 | 0 | — |
| Q10 program ownership | Program Readiness | 3 | 3 | 1 | 1 | 0 | — |
| Q10a governance vacuum (when Q10=D) | Program Readiness | 3 | 1 | 1 | 0 | 0 | — |
| Q11 architecture speed | Program Readiness | 3 | 3 | 2 | 1 | 0 | — |
| Q12 urgency driver | Org Reality | 3 | 2 | **2** ← *not 3* | 2 | 1 | 0 |

Bold cells are scores that deviated from the spec's option-order default during calibration on 2026-05-09. The four changes and their rationale are recorded in [[2026-05-09-diagnostic-scoring-calls]].

## Branch logic (which questions get asked)

Resolved at runtime by `computeFlow(answers)` in `lib/diagnostic/flow.ts`.

- **Q3 controls Q9 replacement** (not just insertion):
  - Q3 ∈ {A "still exploring", B "pilots, no production"} → **Q9 is replaced by Q9a**. Q9 is not asked. Q9c/Q9d (which depend on Q9) are also skipped.
  - Q3 = D ("scaling but hitting walls") → **Q9 is replaced by Q9b**. Same skip semantics.
  - Q3 = C ("in production but not scaling") → Q9 fires normally; Q9c/Q9d may follow based on Q9's answer.
- **Q6 inserts**:
  - Q6 = A ("primary reason failure") → Q6a is inserted before Q7.
  - Q6 = D ("no, data hasn't been an issue") → Q6b is inserted before Q7 (the confidence test).
- **Q9 inserts** (only when Q9 fires, i.e. Q3 = C):
  - Q9 = A ("went to production") → Q9d.
  - Q9 = C ("quietly shelved") → Q9c.
- **Q10 insert**:
  - Q10 = D ("ownership unclear") → Q10a.

A complete session is 12 questions (no inserts) up to 14 questions (max branches firing). Q9 family always contributes exactly one question (Q9 OR Q9a OR Q9b) — never two — plus optionally Q9c or Q9d.

## Domain weights

Weighted total = `data_foundation% × 0.5 + program_readiness% × 0.3 + org_reality% × 0.2`. Per spec §5.1 + CEO-review confirmation.

| Domain | Weight | Questions contributing |
|---|---|---|
| Data Foundation | **50%** | Q4, Q5, Q6, Q6a/b, Q7, Q8, Q9 + variants |
| Program Readiness | **30%** | Q3, Q10, Q10a, Q11 |
| Org Reality | **20%** | Q1, Q2, Q12 |

Note: spec listed Q9 in both Data Foundation and Program Readiness. We assigned it to Data Foundation only — the question content is fundamentally a data-foundation diagnostic surfaced through program output.

## Tier boundaries

Per spec §5.2. Score ranges are inclusive on both ends.

| Score | Tier | Public label | Report tone |
|---|---|---|---|
| 0–25 | Critical | Foundation Risk | Direct and urgent. Names failure modes that will occur. Strong CTA. |
| 26–50 | Emerging | Structurally Exposed | Honest about gaps. Acknowledges intent. Points to sequenced remediation. |
| 51–75 | Developing | Program-Ready | Affirms progress. Identifies the two or three blockers that emerge at scale. |
| 76–100 | Advanced | Scale-Ready | Credible praise. Identifies edge-case risks at scale. Softer CTA. |

`deriveTier(score)` walks `TIER_BOUNDARIES` in order and returns the first matching range. Defensive fallback to Critical if a score lands outside 0–100 (should never happen — would indicate a scoring bug).

## Risk flag rules

Up to 3 flags per session, severity-sorted (critical → high → medium), with ties broken by content-array order. Per spec §5.3.

| Code | Trigger | Severity |
|---|---|---|
| `no_data_lineage` | Q4 = D | **critical** |
| `prior_failure_unexplained` | Q6 = A AND Q6a = D | **critical** |
| `no_explainability_owner` | Q7 = D | high |
| `vendor_default_decisioning` | Q10 = D AND Q10a = C | high |
| `shelved_no_postmortem` | Q9c = E | high |
| `governance_aspirational` | Q8 = C | medium |

Codes are stable across spec revisions so historical reports stay readable.

## Priority triggers (CRM tagging)

Independent of the readiness score. Some answers warrant immediate sales outreach regardless of org maturity. The W2 scoring engine reads `PRIORITY_TRIGGERS` from `lib/diagnostic/content.ts`, evaluates against session answers, and sets `lead.is_priority = true` on the CRM webhook.

| Code | Question | Answer | Reason |
|---|---|---|---|
| (single) | Q12 | B | Board or regulatory mandate — buyer is under board/regulator timeline pressure regardless of org maturity. Highest-priority outreach. |

A board-mandated executive with a strong readiness profile is still a priority lead — the *urgency* sits with the buyer, not the *foundation*.

## Persona test results — 2026-05-09

Run with `pnpm dlx tsx scripts/test-diagnostic.ts`. Engine matches expected behaviour for three plausible respondent profiles.

### Persona A — Government modernisation director, board-mandated, mid-maturity

Sector Government (Q1=C), owns budget (Q2=A), pilots-only maturity (Q3=B → Q9 replaced by Q9a), reconstruct-in-weeks lineage (Q4=C), two/three sources (Q5=B), data was contributing factor (Q6=B), reconstructable explainability (Q7=B), documented governance (Q8=B), self-aware barrier "data not in state" (Q9a=A), steering-committee ownership (Q10=B), months for arch changes (Q11=C), board mandate (Q12=B).

- **Flow:** 12 questions (`q1 → q2 → q3 → q4 → q5 → q6 → q7 → q8 → q9a → q10 → q11 → q12`)
- **Total: 59** → **Developing (Program-Ready)**
- **Domains:** Data Foundation 59% · Program Readiness 38% · Org Reality 88%
- **Risk flags:** none
- **Priority: TRUE** — board mandate trigger

Reads correctly: real lead worth engaging, narrative tone affirms progress while flagging blockers, CRM tags priority for fast follow-up regardless of the moderate tier.

### Persona B — Financial services CDO post-failure (multiple flags expected)

FS sector (Q1=A), influencer not budget-holder (Q2=B), in-production-not-scaling (Q3=C → Q9 fires), no documented lineage (Q4=D), don't know sources (Q5=D), data was primary failure reason (Q6=A → Q6a fires), root cause still not understood (Q6a=D), nobody owns explainability (Q7=D), aspirational governance (Q8=C), quietly shelved last initiative (Q9=C → Q9c fires), shelving reason never documented (Q9c=E), IT/data team owns program (Q10=C), arch changes never been done cleanly (Q11=D), cost-reduction urgency (Q12=C).

- **Flow:** 14 questions (Q6a + Q9c inserts)
- **Total: 29** → **Emerging (Structurally Exposed)**
- **Domains:** Data Foundation **0%** · Program Readiness 38% · Org Reality 88%
- **Risk flags (3 of 5 matched, severity-capped):**
  - `no_data_lineage` (critical)
  - `prior_failure_unexplained` (critical)
  - `no_explainability_owner` (high)
  - *dropped:* `shelved_no_postmortem` (high, later in array)
  - *dropped:* `governance_aspirational` (medium)
- **Priority:** false

**Notable:** an organisation with completely broken Data Foundation (0% raw) lands in **Emerging not Critical** because Org Reality scores 88% — sector (FS=3), role (Influencer=2), and urgency (cost reduction=2) pull the weighted total up. The Q1 sector signal is doing more work than the spec's "industry risk modifier" framing suggests; an "Other" sector with the same diagnostic answers would land in Critical.

### Persona C — Mature tech co at scale (no flags, scaling-walls cohort)

Other sector (Q1=E), owns budget (Q2=A), scaling but hitting walls (Q3=D → Q9 replaced by Q9b), documented lineage (Q4=A), single source (Q5=A), aware of risk (Q6=C), explainability tooling (Q7=A), active governance (Q8=A), cost-exceeds-value walls (Q9b=E), named exec (Q10=A), days for arch changes (Q11=A), competitive urgency (Q12=A).

- **Flow:** 12 questions (Q9 replaced by Q9b, no inserts)
- **Total: 88** → **Advanced (Scale-Ready)**
- **Domains:** Data Foundation 93% · Program Readiness 88% · Org Reality 75%
- **Risk flags:** none
- **Priority:** false

Reads correctly: strong foundation answers earn Advanced tier even though the scaling-walls maturity (Q3=D) scores low — the calibration ([[2026-05-09-diagnostic-scoring-calls]]) of Q3=D scoring 1 prevents urgency from masquerading as readiness, while Q4–Q11 pull the foundation total back up to 93%. Soft-CTA tone appropriate.

## Engine implementation surface

- `lib/diagnostic/types.ts` — Question, AnswerOption, Domain, Tier, RiskFlag types
- `lib/diagnostic/content.ts` — QUESTIONS, TIER_BOUNDARIES, RISK_FLAG_RULES, PRIORITY_TRIGGERS, DOMAIN_WEIGHTS
- `lib/diagnostic/flow.ts` — computeFlow + getNextQuestionId + getProgress (branch + replacement resolver)
- `lib/diagnostic/scoring.ts` — scoreSession, deriveTier, evaluateRiskFlags, evaluatePriorityTriggers, evaluateSession
- `scripts/test-diagnostic.ts` — 23 sanity assertions + 3 persona reports

## When to revisit

- After 50+ real submissions: review whether Persona B's "FS CDO with broken foundation lands in Emerging not Critical" is the right outcome. If the report tone for Emerging doesn't land hard enough on these respondents, retune Q1 sector scores down (sector becomes a context modifier with smaller weight) or shift Data Foundation weight from 50% → 60%.
- If consulting calls don't convert from board-mandate priority leads: the priority trigger framing in the report CTA may need to differ from the regular tier-driven copy.
- If Claude's narrative regularly misses the spec's tone-by-tier rules: retune the system prompt rather than the scores.
