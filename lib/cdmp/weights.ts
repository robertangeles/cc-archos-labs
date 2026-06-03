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
  weakChapters?: string[],
): ChapterDistribution[] {
  if (weakChapters && weakChapters.length > 0) {
    return distributeWeakFocused(total, knowledgeAreas, weakChapters);
  }
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

function distributeWeakFocused(
  total: number,
  knowledgeAreas: KnowledgeArea[],
  weakChapters: string[],
): ChapterDistribution[] {
  const weakSet = new Set(weakChapters);
  const weakAreas = knowledgeAreas.filter((a) => weakSet.has(a.slug));
  const strongAreas = knowledgeAreas.filter((a) => !weakSet.has(a.slug));

  const weakTotal = Math.round(total * 0.8);
  const strongTotal = total - weakTotal;

  const weakDist = weakAreas.length > 0
    ? evenDistribute(weakTotal, weakAreas)
    : [];
  const strongDist = strongAreas.length > 0
    ? evenDistribute(strongTotal, strongAreas)
    : [];

  return [...weakDist, ...strongDist];
}

function evenDistribute(
  total: number,
  areas: KnowledgeArea[],
): ChapterDistribution[] {
  const base = Math.floor(total / areas.length);
  let remainder = total - base * areas.length;

  return areas.map((area) => {
    const extra = remainder > 0 ? 1 : 0;
    if (extra) remainder--;
    return {
      slug: area.slug,
      label: area.label,
      chapter: area.chapter,
      questionCount: Math.max(1, base + extra),
    };
  });
}
