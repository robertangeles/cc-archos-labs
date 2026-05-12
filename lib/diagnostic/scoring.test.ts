import { describe, expect, it } from "vitest";
import { deriveTier, evaluatePriorityTriggers, scoreSession } from "./scoring";
import type { SessionAnswers } from "./flow";
import type { DiagnosticContent } from "./content-config-shared";

// Smoke tests covering the scoring engine's contract. Not exhaustive —
// see scripts/test-diagnostic.ts for the full persona suite. This file
// exists to prove the Vitest harness runs and that the highest-value
// invariants are guarded by CI.
//
// The fixture below is the minimum that exercises the code paths under
// test. Real diagnostic content lives in the admin row at site_setting
// key='diagnostic_content' and isn't relevant to these unit tests.

const FIXTURE: DiagnosticContent = {
  version: "test-fixture",
  questions: [
    {
      id: "q12",
      block: 3,
      domain: "org_reality",
      text: "What is driving urgency?",
      options: [
        { code: "A", label: "Competitive", score: 2 },
        { code: "B", label: "Board mandate", score: 2 },
        { code: "C", label: "Cost reduction", score: 2 },
        { code: "D", label: "Internal champion", score: 1 },
        { code: "E", label: "No urgency", score: 0 },
      ],
    },
  ],
  riskFlagRules: [],
  priorityTriggers: [
    {
      questionId: "q12",
      answer: "B",
      reason: "Board mandate — buyer is under timeline pressure.",
    },
  ],
  tierBoundaries: [
    { tier: "Critical", label: "Foundation Risk", min: 0, max: 25 },
    { tier: "Emerging", label: "Structurally Exposed", min: 26, max: 50 },
    { tier: "Developing", label: "Program-Ready", min: 51, max: 75 },
    { tier: "Advanced", label: "Scale-Ready", min: 76, max: 100 },
  ],
  domainWeights: {
    data_foundation: 0.5,
    program_readiness: 0.3,
    org_reality: 0.2,
  },
};

describe("deriveTier", () => {
  it("maps each tier boundary edge to the right tier", () => {
    expect(deriveTier(0, FIXTURE).tier).toBe("Critical");
    expect(deriveTier(25, FIXTURE).tier).toBe("Critical");
    expect(deriveTier(26, FIXTURE).tier).toBe("Emerging");
    expect(deriveTier(50, FIXTURE).tier).toBe("Emerging");
    expect(deriveTier(51, FIXTURE).tier).toBe("Developing");
    expect(deriveTier(75, FIXTURE).tier).toBe("Developing");
    expect(deriveTier(76, FIXTURE).tier).toBe("Advanced");
    expect(deriveTier(100, FIXTURE).tier).toBe("Advanced");
  });

  it("falls back to Critical for out-of-range scores", () => {
    expect(deriveTier(-1, FIXTURE).tier).toBe("Critical");
    expect(deriveTier(101, FIXTURE).tier).toBe("Critical");
  });
});

describe("scoreSession", () => {
  it("returns zero across all domains for an empty session", () => {
    const result = scoreSession({}, FIXTURE);
    expect(result.total).toBe(0);
    expect(result.data_foundation.percent).toBe(0);
    expect(result.program_readiness.percent).toBe(0);
    expect(result.org_reality.percent).toBe(0);
  });

  it("ignores unknown question ids without throwing", () => {
    const answers = { qdoesnotexist: "A" } as unknown as SessionAnswers;
    expect(() => scoreSession(answers, FIXTURE)).not.toThrow();
    expect(scoreSession(answers, FIXTURE).total).toBe(0);
  });
});

describe("evaluatePriorityTriggers", () => {
  it("returns no priority for an empty session", () => {
    const result = evaluatePriorityTriggers({}, FIXTURE);
    expect(result.isPriority).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("flags Q12=B as priority (board-mandate trigger)", () => {
    const result = evaluatePriorityTriggers(
      { q12: "B" } as SessionAnswers,
      FIXTURE,
    );
    expect(result.isPriority).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
