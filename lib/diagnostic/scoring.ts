import {
  DOMAIN_WEIGHTS,
  PRIORITY_TRIGGERS,
  RISK_FLAG_RULES,
  TIER_BOUNDARIES,
  getQuestion,
} from "./content";
import {
  DOMAINS,
  type AnswerCode,
  type Domain,
  type DomainScore,
  type RiskFlag,
  type RiskSeverity,
  type SessionScore,
  type TierBoundary,
} from "./types";
import type { SessionAnswers } from "./flow";

// AI Readiness Assessment scoring engine. Pure functions, no I/O,
// fully deterministic — every input maps to exactly one output. The
// W2 SPA renders results from these. The W3 LLM client passes results
// + answers to Claude for narrative generation.

// ----------------------------------------------------------------------------
// Score a session — per-domain raw/max/percent + weighted total
// ----------------------------------------------------------------------------

// Strategy:
//   1. Walk every (questionId → answerCode) pair the user gave.
//   2. Look up the question (skip silently if it's an unknown ID — the
//      content file is the single source of truth and stale IDs from a
//      cached frontend should fail soft, not crash the report).
//   3. Add the chosen option's score to that question's domain. Track
//      `max` separately by adding the highest-scoring option for that
//      same question — domain percentages must reflect what the user
//      could actually have scored given which questions they were
//      asked, not the static maximum (branches change which questions
//      get asked).
//   4. Convert per-domain raw/max into a 0–100 percent.
//   5. Weight via DOMAIN_WEIGHTS (50 / 30 / 20) for the final 0–100.

export function scoreSession(answers: SessionAnswers): SessionScore {
  const acc: Record<Domain, { raw: number; max: number }> = {
    data_foundation: { raw: 0, max: 0 },
    program_readiness: { raw: 0, max: 0 },
    org_reality: { raw: 0, max: 0 },
  };

  for (const [questionId, answerCode] of Object.entries(answers)) {
    if (!answerCode) continue;
    const question = getQuestion(questionId);
    if (!question) continue;
    const option = question.options.find((o) => o.code === answerCode);
    if (!option) continue;

    const optionMax = Math.max(...question.options.map((o) => o.score));
    acc[question.domain].raw += option.score;
    acc[question.domain].max += optionMax;
  }

  const data_foundation = toDomainScore(acc.data_foundation);
  const program_readiness = toDomainScore(acc.program_readiness);
  const org_reality = toDomainScore(acc.org_reality);

  const total = Math.round(
    data_foundation.percent * DOMAIN_WEIGHTS.data_foundation +
      program_readiness.percent * DOMAIN_WEIGHTS.program_readiness +
      org_reality.percent * DOMAIN_WEIGHTS.org_reality,
  );

  return { data_foundation, program_readiness, org_reality, total };
}

function toDomainScore(d: { raw: number; max: number }): DomainScore {
  const percent = d.max === 0 ? 0 : Math.round((d.raw / d.max) * 100);
  return { raw: d.raw, max: d.max, percent };
}

// ----------------------------------------------------------------------------
// Derive tier from weighted total
// ----------------------------------------------------------------------------

export function deriveTier(score: number): TierBoundary {
  for (const t of TIER_BOUNDARIES) {
    if (score >= t.min && score <= t.max) return t;
  }
  // Defensive fallback — should never hit if boundaries cover 0–100.
  // If a score lands outside (e.g. clamped wrong), default to the most
  // conservative (highest-risk) tier rather than incorrectly upgrade.
  return TIER_BOUNDARIES[0];
}

// ----------------------------------------------------------------------------
// Evaluate risk flags — return matched flags, severity-ordered, max 3
// ----------------------------------------------------------------------------

const SEVERITY_ORDER: Record<RiskSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

export function evaluateRiskFlags(answers: SessionAnswers): RiskFlag[] {
  const matched: RiskFlag[] = [];

  for (const rule of RISK_FLAG_RULES) {
    const allConditionsMatch = rule.trigger.every((cond) => {
      const actual = answers[cond.questionId];
      if (actual === undefined) return false;
      const expected = Array.isArray(cond.answer) ? cond.answer : [cond.answer];
      return expected.includes(actual);
    });

    if (allConditionsMatch) {
      matched.push({
        code: rule.code,
        title: rule.title,
        body: rule.body,
        severity: rule.severity,
      });
    }
  }

  // Sort by severity (critical first), then preserve content.ts order
  // for ties via stable sort. Slice to spec's max-3-per-report cap.
  matched.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return matched.slice(0, 3);
}

// ----------------------------------------------------------------------------
// Evaluate priority triggers — does this session warrant CRM is_priority?
// ----------------------------------------------------------------------------

export function evaluatePriorityTriggers(answers: SessionAnswers): {
  isPriority: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  for (const trigger of PRIORITY_TRIGGERS) {
    if (answers[trigger.questionId] === trigger.answer) {
      reasons.push(trigger.reason);
    }
  }

  return { isPriority: reasons.length > 0, reasons };
}

// ----------------------------------------------------------------------------
// Convenience: full result blob — what the report and CRM webhook need
// ----------------------------------------------------------------------------

export interface SessionResult {
  score: SessionScore;
  tier: TierBoundary;
  riskFlags: RiskFlag[];
  isPriority: boolean;
  priorityReasons: string[];
}

export function evaluateSession(answers: SessionAnswers): SessionResult {
  const score = scoreSession(answers);
  const tier = deriveTier(score.total);
  const riskFlags = evaluateRiskFlags(answers);
  const { isPriority, reasons } = evaluatePriorityTriggers(answers);
  return {
    score,
    tier,
    riskFlags,
    isPriority,
    priorityReasons: reasons,
  };
}

// Re-export for callers that want it in one place.
export { DOMAINS };
