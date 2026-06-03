import type { CdmpConfig, KnowledgeArea } from "./config-shared";

export interface AnswerRecord {
  knowledgeArea: string;
  isCorrect: boolean;
}

export interface ChapterScore {
  slug: string;
  label: string;
  totalQuestions: number;
  correctCount: number;
  percentCorrect: number;
}

export interface ExamResult {
  totalQuestions: number;
  correctCount: number;
  percentCorrect: number;
  thresholds: {
    associate: { score: number; passed: boolean };
    practitioner: { score: number; passed: boolean };
    master: { score: number; passed: boolean };
  };
  perChapter: ChapterScore[];
}

export function scoreExam(
  answers: AnswerRecord[],
  knowledgeAreas?: KnowledgeArea[],
  passThresholds?: CdmpConfig["passThresholds"],
): ExamResult {
  const thresholds = passThresholds ?? { associate: 60, practitioner: 70, master: 80 };

  const totalQuestions = answers.length;
  const correctCount = answers.filter((a) => a.isCorrect).length;
  const percentCorrect =
    totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  const chapterMap = new Map<string, { total: number; correct: number }>();

  for (const answer of answers) {
    const entry = chapterMap.get(answer.knowledgeArea) ?? {
      total: 0,
      correct: 0,
    };
    entry.total++;
    if (answer.isCorrect) entry.correct++;
    chapterMap.set(answer.knowledgeArea, entry);
  }

  const areaLabels = new Map(
    (knowledgeAreas ?? []).map((a) => [a.slug, a.label]),
  );

  const testedChapters: ChapterScore[] = [...chapterMap.entries()].map(
    ([slug, entry]) => ({
      slug,
      label: areaLabels.get(slug) ?? slug,
      totalQuestions: entry.total,
      correctCount: entry.correct,
      percentCorrect:
        entry.total > 0
          ? Math.round((entry.correct / entry.total) * 100)
          : 0,
    }),
  );

  const testedSlugs = new Set(testedChapters.map((c) => c.slug));
  const untestedChapters: ChapterScore[] = (knowledgeAreas ?? [])
    .filter((a) => !testedSlugs.has(a.slug))
    .map((a) => ({
      slug: a.slug,
      label: a.label,
      totalQuestions: 0,
      correctCount: 0,
      percentCorrect: -1,
    }));

  const perChapter = [...testedChapters, ...untestedChapters];

  return {
    totalQuestions,
    correctCount,
    percentCorrect,
    thresholds: {
      associate: {
        score: thresholds.associate,
        passed: percentCorrect >= thresholds.associate,
      },
      practitioner: {
        score: thresholds.practitioner,
        passed: percentCorrect >= thresholds.practitioner,
      },
      master: {
        score: thresholds.master,
        passed: percentCorrect >= thresholds.master,
      },
    },
    perChapter,
  };
}
