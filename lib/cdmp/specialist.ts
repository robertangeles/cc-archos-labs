import "server-only";
import { cache } from "react";
import { getChapterChunkCounts } from "@/lib/knowledge/search";
import { getCdmpConfig } from "./config";
import { SPECIALIST_AREA_SLUGS, type SpecialistAreaSlug } from "./config-shared";

// How many questions a chapter can sustain before repetition shows. With
// seed + nearest-neighbour sampling a chapter supports roughly 2 questions per
// chunk (each chunk can seed a distinct cluster, and the LLM varies wording),
// so cap at 2x the embedded-chunk count, clamped to a sane floor/ceiling.
export function specialistMaxQuestions(poolSize: number): number {
  return Math.min(100, poolSize * 2);
}

export interface SpecialistArea {
  slug: SpecialistAreaSlug;
  label: string;
  chapter: string; // e.g. "Chapter 13"
  poolSize: number; // embedded chunks tagged to this chapter
  maxQuestions: number; // supply-derived cap
}

// The 7 specialist subjects with their live chapter pool sizes + caps.
// One COUNT query for all chapters; cached per request. Drives the config
// picker (which counts are available) and the specialist landing pages.
export const getSpecialistAreas = cache(async (): Promise<SpecialistArea[]> => {
  const [config, counts] = await Promise.all([
    getCdmpConfig(),
    getChapterChunkCounts(),
  ]);
  const result: SpecialistArea[] = [];
  for (const slug of SPECIALIST_AREA_SLUGS) {
    const area = config.knowledgeAreas.find((a) => a.slug === slug);
    if (!area) continue; // covered by the cdmp config test
    const poolSize = counts.get(area.chapter) ?? 0;
    result.push({
      slug,
      label: area.label,
      chapter: area.chapter,
      poolSize,
      maxQuestions: specialistMaxQuestions(poolSize),
    });
  }
  return result;
});

export const getSpecialistArea = cache(
  async (slug: string): Promise<SpecialistArea | null> => {
    const areas = await getSpecialistAreas();
    return areas.find((a) => a.slug === slug) ?? null;
  },
);
