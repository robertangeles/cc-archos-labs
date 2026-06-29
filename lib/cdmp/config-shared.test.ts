import { describe, expect, it } from "vitest";
import {
  SPECIALIST_AREA_SLUGS,
  isSpecialistAreaSlug,
  CDMP_CONFIG_STARTER,
} from "./config-shared";

describe("SPECIALIST_AREA_SLUGS", () => {
  it("has 7 unique specialist subjects", () => {
    expect(SPECIALIST_AREA_SLUGS).toHaveLength(7);
    expect(new Set(SPECIALIST_AREA_SLUGS).size).toBe(7);
  });

  // The constant is the single source of truth, but every slug must correspond
  // to a real knowledge area, or generation/cap lookups silently fail.
  it("every specialist slug exists in the config knowledge areas", () => {
    const known = new Set(CDMP_CONFIG_STARTER.knowledgeAreas.map((a) => a.slug));
    for (const slug of SPECIALIST_AREA_SLUGS) {
      expect(known.has(slug)).toBe(true);
    }
  });

  it("each specialist area maps to a chapter", () => {
    for (const slug of SPECIALIST_AREA_SLUGS) {
      const area = CDMP_CONFIG_STARTER.knowledgeAreas.find((a) => a.slug === slug);
      expect(area?.chapter).toMatch(/^Chapter \d+$/);
    }
  });
});

describe("isSpecialistAreaSlug", () => {
  it("accepts the 7 specialist slugs", () => {
    expect(isSpecialistAreaSlug("data_quality")).toBe(true);
    expect(isSpecialistAreaSlug("data_governance")).toBe(true);
  });

  it("rejects fundamentals-only areas and unknown strings", () => {
    expect(isSpecialistAreaSlug("data_security")).toBe(false); // a real area, but not a specialist exam
    expect(isSpecialistAreaSlug("data_ethics")).toBe(false);
    expect(isSpecialistAreaSlug("")).toBe(false);
    expect(isSpecialistAreaSlug("'; DROP TABLE cdmp_exam_session; --")).toBe(false);
  });
});
