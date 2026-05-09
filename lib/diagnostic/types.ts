// AI Readiness Assessment — content + scoring type model.
//
// All Phase 2 code that touches the diagnostic (UI rendering, scoring
// engine, branch logic, report generator, admin) imports from here so
// shape changes propagate compile-time. Question wording, scores, and
// weights live in lib/diagnostic/content.ts as concrete data the
// product spec drops directly into.

// ----------------------------------------------------------------------------
// Domains — three lenses scored independently per the CEO-review decision
// ----------------------------------------------------------------------------

export type Domain = "data_foundation" | "program_readiness" | "org_reality";

export const DOMAINS: readonly Domain[] = [
  "data_foundation",
  "program_readiness",
  "org_reality",
] as const;

// Display labels for the report cards. Source of truth for capitalisation.
export const DOMAIN_LABELS: Record<Domain, string> = {
  data_foundation: "Data Foundation",
  program_readiness: "Program Readiness",
  org_reality: "Org Reality",
};

// Weighting per CEO-review decision: 50% / 30% / 20%. Sum to 1.
export interface DomainWeights {
  data_foundation: number;
  program_readiness: number;
  org_reality: number;
}

// ----------------------------------------------------------------------------
// Tiers — final verdict bucket, derived from total weighted score
// ----------------------------------------------------------------------------

export type Tier = "Critical" | "Emerging" | "Developing" | "Advanced";

export const TIERS: readonly Tier[] = [
  "Critical",
  "Emerging",
  "Developing",
  "Advanced",
] as const;

export interface TierBoundary {
  tier: Tier;
  // Public-facing label per spec §5.2 (e.g. "Foundation Risk",
  // "Structurally Exposed", "Program-Ready", "Scale-Ready"). Distinct
  // from `tier` so the internal code stays stable while marketing copy
  // can iterate.
  label: string;
  // Inclusive lower / upper bound on the 0–100 weighted total.
  min: number;
  max: number;
}

// ----------------------------------------------------------------------------
// Questions — 12 base + 7 branch per spec §3
// ----------------------------------------------------------------------------

// Per the spec's answer-card UI: select-one. Most questions have 4
// options (A–D); a few (Q1 industry, Q9a/b/c barriers, Q12 urgency)
// have 5 (A–E). Codes are stable across versions so historical
// answers stay readable if wording changes.
export type AnswerCode = "A" | "B" | "C" | "D" | "E";

export interface AnswerOption {
  code: AnswerCode;
  label: string;
  // Optional follow-up sentence shown in the card under the label.
  description?: string;
  // Per-answer score on the 0–3 scale defined by the spec.
  score: 0 | 1 | 2 | 3;
}

export type QuestionBlock = 1 | 2 | 3;

export const BLOCK_LABELS: Record<QuestionBlock, string> = {
  1: "Context",
  2: "Data foundation",
  3: "Urgency",
};

// A branch question is shown only when its parent received specific answers.
export interface BranchTrigger {
  parentQuestionId: string;
  // Show this branch when the parent answer is in this set.
  triggerAnswers: AnswerCode[];
}

export interface Question {
  // Stable across spec versions (e.g. 'q1', 'q6a'). Used as JSON keys
  // in assessment_session.answers and risk-flag rule references.
  id: string;
  block: QuestionBlock;
  domain: Domain;
  // The text shown on the question card.
  text: string;
  // Practitioner commentary on what this question actually measures.
  // Not shown to the user — kept for review and future-author handoff.
  intent?: string;
  options: AnswerOption[];
  // Present when this is a conditional follow-up to another question.
  branch?: BranchTrigger;
}

// Helper: is a question a branch (conditional) vs a base question.
export function isBranchQuestion(q: Question): boolean {
  return q.branch !== undefined;
}

// ----------------------------------------------------------------------------
// Risk flags — narrative red flags surfaced separately from the score
// ----------------------------------------------------------------------------

export type RiskSeverity = "critical" | "high" | "medium";

// Per spec §5.3: triggered by specific answer combinations across one
// or more questions. ALL conditions in `trigger` must match for the flag
// to fire; any of the listed answers in a single condition is enough.
export interface RiskFlagRule {
  // Stable code referenced in rules + the report. e.g. 'data_lineage_absent'.
  code: string;
  title: string;
  // One- or two-sentence body shown in the report card.
  body: string;
  severity: RiskSeverity;
  // AND across array entries, OR within each entry's `answer` list.
  trigger: Array<{
    questionId: string;
    answer: AnswerCode | AnswerCode[];
  }>;
}

// A flag that's been evaluated against a specific session — what the
// report renders + what's stored in assessment_session.risk_flags.
export interface RiskFlag {
  code: string;
  title: string;
  body: string;
  severity: RiskSeverity;
}

// ----------------------------------------------------------------------------
// Computed score shape — output of the scoring engine
// ----------------------------------------------------------------------------

export interface DomainScore {
  // Sum of answer scores for questions in this domain.
  raw: number;
  // Maximum possible sum given which questions were answered (varies
  // because of branches).
  max: number;
  // raw/max as a 0–100 percentage (rounded to nearest integer).
  percent: number;
}

export interface SessionScore {
  data_foundation: DomainScore;
  program_readiness: DomainScore;
  org_reality: DomainScore;
  // Weighted total on 0–100 scale, derived via DOMAIN_WEIGHTS.
  total: number;
}
