import type { KnowledgeArea } from "./config-shared";

export interface ChapterDistribution {
  slug: string;
  label: string;
  chapter: string;
  questionCount: number;
}

export function distributeQuestions(
  total: number,
  knowledgeAreas: KnowledgeArea[],
): ChapterDistribution[] {
  const raw = knowledgeAreas.map((area) => ({
    slug: area.slug,
    label: area.label,
    chapter: area.chapter,
    weight: area.weight,
    questionCount: Math.max(1, Math.round(area.weight * total)),
  }));

  let sum = raw.reduce((acc, a) => acc + a.questionCount, 0);
  const sorted = [...raw].sort((a, b) => b.weight - a.weight);

  while (sum > total) {
    for (const area of sorted) {
      if (area.questionCount > 1 && sum > total) {
        area.questionCount--;
        sum--;
      }
    }
  }

  while (sum < total) {
    for (const area of sorted) {
      if (sum < total) {
        area.questionCount++;
        sum++;
      }
    }
  }

  return raw.map(({ slug, label, chapter, questionCount }) => ({
    slug,
    label,
    chapter,
    questionCount,
  }));
}
