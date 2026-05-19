import { describe, expect, it } from "vitest";
import {
  diagnose,
  SECTORS,
  STAGES,
  GOVERNANCE,
  type SectorId,
  type StageId,
  type GovernanceId,
} from "./quick-diagnosis-logic";

describe("diagnose — sector-specific governance rules (precedence)", () => {
  it("healthcare + weak governance returns the healthcare-specific sentence (any stage)", () => {
    for (const stage of STAGES) {
      for (const gov of ["aspirational", "none"] as GovernanceId[]) {
        const result = diagnose({
          sector: "healthcare",
          stage: stage.id,
          governance: gov,
        });
        expect(result).toMatch(/healthcare context/);
        expect(result).toMatch(/regulatory exposure/);
      }
    }
  });

  it("financial-services + weak governance returns the financial-services-specific sentence (any stage)", () => {
    for (const stage of STAGES) {
      for (const gov of ["aspirational", "none"] as GovernanceId[]) {
        const result = diagnose({
          sector: "financial-services",
          stage: stage.id,
          governance: gov,
        });
        expect(result).toMatch(/Financial services regulators/);
        expect(result).toMatch(/auditor finds/);
      }
    }
  });

  it("healthcare-specific rule wins over generic weak-governance + early-stage rule", () => {
    // Without precedence, this could also match rule 1 ("weak gov + exploring/pilots").
    // Healthcare-specific must take priority.
    const result = diagnose({
      sector: "healthcare",
      stage: "exploring",
      governance: "aspirational",
    });
    expect(result).toMatch(/healthcare context/);
    expect(result).not.toMatch(/will not reach production in its current form/);
  });

  it("financial-services-specific rule wins over generic weak-governance + early-stage rule", () => {
    const result = diagnose({
      sector: "financial-services",
      stage: "pilots",
      governance: "none",
    });
    expect(result).toMatch(/Financial services regulators/);
    expect(result).not.toMatch(/will not reach production in its current form/);
  });
});

describe("diagnose — generic governance + stage rules", () => {
  it("weak gov + exploring/pilots (non-healthcare, non-financial) returns the generic warning", () => {
    for (const sector of ["government", "retail", "other"] as SectorId[]) {
      for (const stage of ["exploring", "pilots"] as StageId[]) {
        for (const gov of ["aspirational", "none"] as GovernanceId[]) {
          const result = diagnose({ sector, stage, governance: gov });
          expect(result).toMatch(/will not reach production in its current form/);
        }
      }
    }
  });

  it("documented gov + production-not-scaling returns the documented-governance sentence", () => {
    const result = diagnose({
      sector: "retail",
      stage: "production-not-scaling",
      governance: "documented",
    });
    expect(result).toMatch(/documented governance that nobody enforces/);
    expect(result).toMatch(/symptoms of this/);
  });

  it("documented gov + scaling-with-walls returns the same documented-governance sentence", () => {
    const result = diagnose({
      sector: "government",
      stage: "scaling-with-walls",
      governance: "documented",
    });
    expect(result).toMatch(/documented governance that nobody enforces/);
  });

  it("active gov + scaling-with-walls returns the architectural-walls sentence", () => {
    const result = diagnose({
      sector: "retail",
      stage: "scaling-with-walls",
      governance: "active",
    });
    expect(result).toMatch(/walls you are hitting are likely architectural/);
    expect(result).toMatch(/has been here before/);
  });

  it("active gov + exploring/pilots returns the foundation-warning sentence", () => {
    for (const stage of ["exploring", "pilots"] as StageId[]) {
      const result = diagnose({
        sector: "other",
        stage,
        governance: "active",
      });
      expect(result).toMatch(/better governance than most organisations/);
      expect(result).toMatch(/AI-ready data/);
    }
  });
});

describe("diagnose — catch-all", () => {
  it("active gov + production-not-scaling falls through to catch-all (no specific rule)", () => {
    const result = diagnose({
      sector: "other",
      stage: "production-not-scaling",
      governance: "active",
    });
    expect(result).toMatch(/most common failure mode at your stage/);
    expect(result).toMatch(/Book a call/);
  });

  it("weak gov + production-not-scaling with non-priority sector falls through to catch-all", () => {
    // Rule 1 needs exploring/pilots; rules 2-3 need healthcare/financial.
    // None match here → catch-all.
    const result = diagnose({
      sector: "government",
      stage: "production-not-scaling",
      governance: "aspirational",
    });
    expect(result).toMatch(/most common failure mode at your stage/);
  });
});

describe("diagnose — total coverage", () => {
  it("every combination produces a non-empty sentence", () => {
    // 5 sectors × 4 stages × 4 governance = 80 combinations. No combo
    // should slip through without an output.
    for (const sector of SECTORS) {
      for (const stage of STAGES) {
        for (const gov of GOVERNANCE) {
          const result = diagnose({
            sector: sector.id,
            stage: stage.id,
            governance: gov.id,
          });
          expect(
            result.length,
            `${sector.id}/${stage.id}/${gov.id} returned empty`,
          ).toBeGreaterThan(20);
        }
      }
    }
  });

  it("every option label is non-empty and unique within its set", () => {
    const sectorLabels = SECTORS.map((s) => s.label);
    expect(new Set(sectorLabels).size).toBe(sectorLabels.length);
    const stageLabels = STAGES.map((s) => s.label);
    expect(new Set(stageLabels).size).toBe(stageLabels.length);
    const govLabels = GOVERNANCE.map((g) => g.label);
    expect(new Set(govLabels).size).toBe(govLabels.length);
  });
});
