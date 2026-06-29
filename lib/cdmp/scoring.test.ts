import { describe, it, expect } from "vitest";
import { scoreExam, type AnswerRecord } from "./scoring";

function makeAnswers(
  correct: number,
  total: number,
  area = "data_governance",
): AnswerRecord[] {
  return Array.from({ length: total }, (_, i) => ({
    knowledgeArea: area,
    isCorrect: i < correct,
  }));
}

describe("scoreExam", () => {
  it("returns 100% for a perfect score", () => {
    const result = scoreExam(makeAnswers(100, 100));
    expect(result.percentCorrect).toBe(100);
    expect(result.correctCount).toBe(100);
    expect(result.thresholds.associate.passed).toBe(true);
    expect(result.thresholds.practitioner.passed).toBe(true);
    expect(result.thresholds.master.passed).toBe(true);
  });

  it("returns 0% for zero correct", () => {
    const result = scoreExam(makeAnswers(0, 100));
    expect(result.percentCorrect).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.thresholds.associate.passed).toBe(false);
    expect(result.thresholds.practitioner.passed).toBe(false);
    expect(result.thresholds.master.passed).toBe(false);
  });

  it("passes associate at exactly 60%", () => {
    const result = scoreExam(makeAnswers(60, 100));
    expect(result.percentCorrect).toBe(60);
    expect(result.thresholds.associate.passed).toBe(true);
    expect(result.thresholds.practitioner.passed).toBe(false);
  });

  it("fails associate at 59%", () => {
    const result = scoreExam(makeAnswers(59, 100));
    expect(result.percentCorrect).toBe(59);
    expect(result.thresholds.associate.passed).toBe(false);
  });

  it("passes practitioner at exactly 70%", () => {
    const result = scoreExam(makeAnswers(70, 100));
    expect(result.thresholds.practitioner.passed).toBe(true);
    expect(result.thresholds.master.passed).toBe(false);
  });

  it("passes master at exactly 80%", () => {
    const result = scoreExam(makeAnswers(80, 100));
    expect(result.thresholds.master.passed).toBe(true);
  });

  it("handles empty answers", () => {
    const result = scoreExam([]);
    expect(result.totalQuestions).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.percentCorrect).toBe(0);
    expect(result.perChapter).toHaveLength(0);
  });

  it("computes per-chapter breakdown correctly", () => {
    const answers: AnswerRecord[] = [
      ...makeAnswers(3, 5, "data_governance"),
      ...makeAnswers(2, 5, "data_quality"),
      ...makeAnswers(5, 5, "data_architecture"),
    ];

    const result = scoreExam(answers);
    expect(result.totalQuestions).toBe(15);
    expect(result.correctCount).toBe(10);

    const gov = result.perChapter.find((c) => c.slug === "data_governance")!;
    expect(gov.totalQuestions).toBe(5);
    expect(gov.correctCount).toBe(3);
    expect(gov.percentCorrect).toBe(60);

    const qual = result.perChapter.find((c) => c.slug === "data_quality")!;
    expect(qual.totalQuestions).toBe(5);
    expect(qual.correctCount).toBe(2);
    expect(qual.percentCorrect).toBe(40);

    const arch = result.perChapter.find((c) => c.slug === "data_architecture")!;
    expect(arch.totalQuestions).toBe(5);
    expect(arch.correctCount).toBe(5);
    expect(arch.percentCorrect).toBe(100);
  });

  it("only includes chapters that had questions", () => {
    const result = scoreExam(makeAnswers(5, 10, "data_security"));
    expect(result.perChapter).toHaveLength(1);
    expect(result.perChapter[0].slug).toBe("data_security");
  });

  it("rounds percentage correctly", () => {
    const result = scoreExam(makeAnswers(1, 3, "data_governance"));
    expect(result.percentCorrect).toBe(33);
  });

  it("uses custom thresholds when provided", () => {
    const result = scoreExam(makeAnswers(50, 100), undefined, {
      associate: 50,
      practitioner: 60,
      master: 70,
    });
    expect(result.thresholds.associate.passed).toBe(true);
    expect(result.thresholds.practitioner.passed).toBe(false);
  });
});

describe("scoreExam — specialist", () => {
  const areas = [
    { slug: "data_quality", label: "Data Quality", weight: 0.11, chapter: "Chapter 13" },
    { slug: "data_governance", label: "Data Governance", weight: 0.11, chapter: "Chapter 3" },
    { slug: "metadata_management", label: "Metadata Management", weight: 0.11, chapter: "Chapter 12" },
  ];

  it("tags the result as specialist and carries the subject label", () => {
    const result = scoreExam(makeAnswers(8, 10, "data_quality"), areas, undefined, {
      examType: "specialist",
      specialistLabel: "Data Quality",
    });
    expect(result.examType).toBe("specialist");
    expect(result.specialistLabel).toBe("Data Quality");
  });

  it("does NOT pad the other chapters as untested (single subject)", () => {
    const result = scoreExam(makeAnswers(8, 10, "data_quality"), areas, undefined, {
      examType: "specialist",
    });
    expect(result.perChapter).toHaveLength(1);
    expect(result.perChapter[0].slug).toBe("data_quality");
  });

  it("fundamentals still pads untested chapters (unchanged)", () => {
    const result = scoreExam(makeAnswers(8, 10, "data_quality"), areas);
    expect(result.examType).toBe("fundamentals");
    expect(result.perChapter).toHaveLength(3); // 1 tested + 2 untested
  });
});
