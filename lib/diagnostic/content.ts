import type {
  DomainWeights,
  Question,
  RiskFlagRule,
  TierBoundary,
} from "./types";

// AI Readiness Assessment — concrete content per the v1.0 product spec.
//
// This file is the single source of truth for question wording, answer
// options, scoring weights, branch logic, risk flag rules, tier
// boundaries, and domain weights. Treat it as data, not code — review it
// end-to-end against the spec before each release.
//
// Content authoring discipline:
//   - Question IDs are stable across spec versions. Add new questions
//     with new IDs; never repurpose an old ID.
//   - Branch question IDs follow `<parentId><suffix>` (e.g. q6a, q9b).
//   - Answer scores follow the spec's 0–3 scale; never invent scores
//     for wording you authored.
//   - Risk flag codes are stable so historical reports stay readable.
//
// IDs are pre-allocated per the spec's structure (Block 1: q1–q3,
// Block 2: q4–q9 + branches, Block 3: q10–q12 + branches). Wording and
// scores are TODO until the spec content is encoded.

// ----------------------------------------------------------------------------
// Domain weights — locked at 50% / 30% / 20% per CEO-review decision
// ----------------------------------------------------------------------------

export const DOMAIN_WEIGHTS: DomainWeights = {
  data_foundation: 0.5,
  program_readiness: 0.3,
  org_reality: 0.2,
};

// ----------------------------------------------------------------------------
// Tier boundaries — TODO: encode from spec §5.1
// ----------------------------------------------------------------------------

// Boundaries reference the weighted-total 0–100 score. Inclusive on both
// ends; the order critical → advanced is intentional (low score → high
// risk = Critical tier).
export const TIER_BOUNDARIES: TierBoundary[] = [
  // TODO(spec): tier ranges from product spec §5.1
  // Example shape (placeholder values — DO NOT SHIP):
  // { tier: "Critical",   min: 0,  max: 25 },
  // { tier: "Emerging",   min: 26, max: 50 },
  // { tier: "Developing", min: 51, max: 75 },
  // { tier: "Advanced",   min: 76, max: 100 },
];

// ----------------------------------------------------------------------------
// Questions — TODO: encode all 12 base + 7 branches verbatim from spec §3
// ----------------------------------------------------------------------------

export const QUESTIONS: Question[] = [
  // ========================================================================
  // Block 1 — Context / Qualification (q1, q2, q3)
  // ========================================================================
  // TODO(spec): q1 — sector / role context
  // TODO(spec): q2 — program maturity stage
  // TODO(spec): q3 — primary AI use case in flight

  // ========================================================================
  // Block 2 — Data Foundation diagnostic (q4–q9 + branches q6a, q6b, q9a–q9d)
  // ========================================================================
  // TODO(spec): q4 — data ownership clarity
  // TODO(spec): q5 — schema / lineage maturity
  // TODO(spec): q6 — quality processes (with branches q6a, q6b)
  // TODO(spec): q7 — governance & access control
  // TODO(spec): q8 — integration / pipeline maturity
  // TODO(spec): q9 — production readiness (with branches q9a–q9d)

  // ========================================================================
  // Block 3 — Urgency / Accountability (q10, q11, q12 + branch q10a)
  // ========================================================================
  // TODO(spec): q10 — exec sponsorship (with branch q10a)
  // TODO(spec): q11 — investment / budget
  // TODO(spec): q12 — urgency flag (drives 'mandate' priority on lead)
];

// ----------------------------------------------------------------------------
// Risk flag rules — TODO: encode from spec §5.3
// ----------------------------------------------------------------------------

// Up to 3 flags surface per session per spec; severity-ordered when
// multiple match. Rule order in this array breaks ties when severities
// are equal (earlier = higher priority).
export const RISK_FLAG_RULES: RiskFlagRule[] = [
  // TODO(spec): risk-flag rules from product spec §5.3
];

// ----------------------------------------------------------------------------
// Helper: lookup tables built once at module load for hot-path use
// ----------------------------------------------------------------------------

export const QUESTIONS_BY_ID: Record<string, Question> = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, q]),
);

export function getQuestion(id: string): Question | undefined {
  return QUESTIONS_BY_ID[id];
}
