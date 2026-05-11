import { describe, expect, it } from "vitest";
import { deriveTier, evaluatePriorityTriggers, scoreSession } from "./scoring";
import type { SessionAnswers } from "./flow";

// Smoke tests covering the scoring engine's contract. Not exhaustive —
// see scripts/test-diagnostic.ts for the full persona suite. This file
// exists to prove the Vitest harness runs and that the highest-value
// invariants are guarded by CI.

describe("deriveTier", () => {
  it("maps each tier boundary edge to the right tier", () => {
    expect(deriveTier(0).tier).toBe("Critical");
    expect(deriveTier(25).tier).toBe("Critical");
    expect(deriveTier(26).tier).toBe("Emerging");
    expect(deriveTier(50).tier).toBe("Emerging");
    expect(deriveTier(51).tier).toBe("Developing");
    expect(deriveTier(75).tier).toBe("Developing");
    expect(deriveTier(76).tier).toBe("Advanced");
    expect(deriveTier(100).tier).toBe("Advanced");
  });

  it("falls back to Critical for out-of-range scores", () => {
    expect(deriveTier(-1).tier).toBe("Critical");
    expect(deriveTier(101).tier).toBe("Critical");
  });
});

describe("scoreSession", () => {
  it("returns zero across all domains for an empty session", () => {
    const result = scoreSession({});
    expect(result.total).toBe(0);
    expect(result.data_foundation.percent).toBe(0);
    expect(result.program_readiness.percent).toBe(0);
    expect(result.org_reality.percent).toBe(0);
  });

  it("ignores unknown question ids without throwing", () => {
    const answers = { qdoesnotexist: "A" } as unknown as SessionAnswers;
    expect(() => scoreSession(answers)).not.toThrow();
    expect(scoreSession(answers).total).toBe(0);
  });
});

describe("evaluatePriorityTriggers", () => {
  it("returns no priority for an empty session", () => {
    const result = evaluatePriorityTriggers({});
    expect(result.isPriority).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("flags Q12=B as priority (board-mandate trigger)", () => {
    const result = evaluatePriorityTriggers({ q12: "B" } as SessionAnswers);
    expect(result.isPriority).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
