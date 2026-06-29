import { describe, expect, it } from "vitest";
import { specialistMaxQuestions } from "./specialist";

describe("specialistMaxQuestions", () => {
  it("allows ~2 questions per embedded chunk", () => {
    expect(specialistMaxQuestions(10)).toBe(20);
    expect(specialistMaxQuestions(23)).toBe(46);
    expect(specialistMaxQuestions(43)).toBe(86);
  });

  it("clamps to 100 for large pools", () => {
    expect(specialistMaxQuestions(60)).toBe(100);
    expect(specialistMaxQuestions(500)).toBe(100);
  });

  it("returns 0 for an empty pool", () => {
    expect(specialistMaxQuestions(0)).toBe(0);
  });
});
