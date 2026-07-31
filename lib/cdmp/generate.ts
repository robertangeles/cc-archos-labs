import "server-only";
import { randomInt } from "node:crypto";
import { generateStructured } from "@/lib/claude";
import {
  searchCdmpSources,
  getChunksByChapter,
  type SearchResult,
  type ChapterChunk,
} from "@/lib/knowledge/search";
import { getCdmpConfig } from "./config";
import type { ChapterDistribution } from "./weights";
import type { CdmpConfig } from "./config-shared";

const CODES = ["A", "B", "C", "D", "E"] as const;

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export interface GeneratedQuestion {
  questionText: string;
  options: Array<{ code: string; label: string }>;
  correctAnswer: string;
  explanation: string;
  knowledgeArea: string;
  dmbokChapterRef: string;
  chunkIds: string[];
}

interface QuestionOutput {
  question: string;
  options: { A: string; B: string; C: string; D: string; E: string };
  correct_answer: "A" | "B" | "C" | "D" | "E";
  explanation: string;
  dmbok_chapter: string;
}

interface VerificationOutput {
  verified: boolean;
  reason: string;
}

async function generateSingleQuestion(
  knowledgeArea: string,
  chapterLabel: string,
  chapterRef: string,
  chunks: SearchResult[],
  config: CdmpConfig,
): Promise<GeneratedQuestion | null> {
  const sourceText = chunks.map((c) => c.content).join("\n\n---\n\n");
  const chunkIds = chunks.map((c) => c.chunkId);

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const genResult = await generateStructured<QuestionOutput>({
        systemPrompt: config.generationPrompt,
        userMessage: `Generate a CDMP practice question about "${chapterLabel}" (${chapterRef}).

SOURCE TEXT:
${sourceText}`,
        maxTokens: config.generationMaxTokens,
      });

      const q = genResult.data;

      const verResult = await generateStructured<VerificationOutput>({
        systemPrompt: config.verificationPrompt,
        userMessage: `SOURCE TEXT:
${sourceText}

GENERATED QUESTION:
${q.question}

OPTIONS:
A) ${q.options.A}
B) ${q.options.B}
C) ${q.options.C}
D) ${q.options.D}
E) ${q.options.E}

STATED CORRECT ANSWER: ${q.correct_answer}`,
        maxTokens: config.verificationMaxTokens,
      });

      if (!verResult.data.verified) {
        continue;
      }

      const originalLabels = [
        q.options.A,
        q.options.B,
        q.options.C,
        q.options.D,
        q.options.E,
      ];
      const correctLabel = q.options[q.correct_answer];
      const shuffled = shuffleArray(originalLabels);
      const options = shuffled.map((label, idx) => ({
        code: CODES[idx],
        label,
      }));
      const correctAnswer = options.find((o) => o.label === correctLabel)!.code;

      return {
        questionText: q.question,
        options,
        correctAnswer,
        explanation: q.explanation,
        knowledgeArea,
        dmbokChapterRef: q.dmbok_chapter || chapterRef,
        chunkIds,
      };
    } catch (err) {
      console.error(
        `[cdmp/generate] attempt ${attempt + 1} failed for ${knowledgeArea}:`,
        err instanceof Error ? err.message : err,
      );
      if (attempt === config.maxRetries) return null;
    }
  }

  return null;
}

// How many questions to generate concurrently. Each question is an
// independent generate+verify LLM round-trip (~20s), so the serial cost
// scales linearly: 100 questions one-at-a-time is ~36 min. Running them
// through a pool collapses that to roughly ceil(count / concurrency)
// waves — 100 questions at 12 → ~3 min, well inside the 5-min session
// JWT TTL. Raise if OpenRouter rate limits allow; lower if they don't.
const GENERATION_CONCURRENCY = 12;

// Run `worker` over every item with at most `limit` in flight at once.
// Results keep input order, so question ordering matches the requested
// chapter distribution. No external dependency — a fixed set of runners
// pull from a shared cursor until the work list is drained.
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runner(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    runner(),
  );
  await Promise.all(runners);
  return results;
}

const MAX_RETRY_WAVES = 2;

async function generateOneTask(
  chapter: ChapterDistribution,
  label: string,
  config: CdmpConfig,
): Promise<GeneratedQuestion | null> {
  try {
    // Scoped by is_cdmp_source, NOT by category. Passing "dmbok" here used to
    // pull in every document that happened to carry that topic label — 8 of
    // PROD's 19 carried it and 6 were wrong for an exam, including The Trusted Advisor and The Pragmatic Programmer.
    // Certification questions were being generated from a consulting book.
    const chunks = await searchCdmpSources(
      chapter.label,
      config.chunksPerQuestion,
    );

    if (chunks.length === 0) {
      console.log(`[cdmp] SKIP: no chunks found for "${chapter.label}" (${label})`);
      return null;
    }

    const question = await generateSingleQuestion(
      chapter.slug,
      chapter.label,
      chapter.chapter,
      chunks,
      config,
    );

    console.log(
      `[cdmp] ${question ? "OK" : "FAIL"}: "${chapter.label}" (${label})`,
    );
    return question;
  } catch (err) {
    console.error(
      `[cdmp] ERROR "${chapter.label}" (${label}):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function generateQuestionBatch(
  chapters: ChapterDistribution[],
): Promise<GeneratedQuestion[]> {
  const config = await getCdmpConfig();
  const targetCount = chapters.reduce((sum, c) => sum + c.questionCount, 0);

  const tasks = chapters
    .filter((chapter) => chapter.questionCount > 0)
    .flatMap((chapter) =>
      Array.from({ length: chapter.questionCount }, (_, i) => ({ chapter, i })),
    );

  const areaCount = chapters.filter((c) => c.questionCount > 0).length;
  console.log(
    `[cdmp] Generating ${tasks.length} question(s) across ${areaCount} area(s), concurrency ${GENERATION_CONCURRENCY}`,
  );

  const settled = await runPool(
    tasks,
    GENERATION_CONCURRENCY,
    ({ chapter, i }) => generateOneTask(chapter, `q${i + 1}`, config),
  );

  const questions = settled.filter(
    (q): q is GeneratedQuestion => q !== null,
  );

  // Retry waves: redistribute failed slots to chapters that succeeded
  const succeededSlugs = new Set(questions.map((q) => q.knowledgeArea));
  const retryPool = chapters.filter(
    (c) => c.questionCount > 0 && succeededSlugs.has(c.slug),
  );

  for (let wave = 1; wave <= MAX_RETRY_WAVES && questions.length < targetCount && retryPool.length > 0; wave++) {
    const deficit = targetCount - questions.length;
    console.log(`[cdmp] Retry wave ${wave}: ${deficit} question(s) still needed`);

    const retryTasks: { chapter: ChapterDistribution; i: number }[] = [];
    for (let j = 0; j < deficit; j++) {
      retryTasks.push({ chapter: retryPool[j % retryPool.length], i: j });
    }

    const retrySettled = await runPool(
      retryTasks,
      GENERATION_CONCURRENCY,
      ({ chapter, i }) => generateOneTask(chapter, `retry-w${wave}-q${i + 1}`, config),
    );

    for (const q of retrySettled) {
      if (q !== null && questions.length < targetCount) {
        questions.push(q);
      }
    }
  }

  console.log(
    `[cdmp] Total generated: ${questions.length}/${targetCount}`,
  );
  return questions;
}

// ============================================================================
// Specialist exams — single-chapter generation
// ============================================================================
// A specialist exam is scoped to ONE DMBOK chapter. Unlike Fundamentals (which
// samples the same top-K chunks for every question in an area), specialist mode
// fetches the chapter's full chunk pool ONCE, then for each question samples a
// coherent set: a random SEED chunk + its nearest neighbours in the pool. This
// gives variety (each question draws a different cluster) without the incoherent
// "3 random unrelated paragraphs" problem. The Fundamentals path above is
// deliberately untouched.

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Pick a random seed chunk + its (k-1) nearest neighbours within the pool, so
// the k chunks handed to the LLM are about the same concept (coherent), not a
// random grab-bag. A fresh random seed per call drives question variety.
function sampleCoherentSet(pool: ChapterChunk[], k: number): ChapterChunk[] {
  if (pool.length <= k) return pool;
  const seedIdx = randomInt(pool.length);
  const seed = pool[seedIdx];
  return pool
    .map((c, i) => ({
      c,
      sim: i === seedIdx ? Infinity : cosineSimilarity(seed.embedding, c.embedding),
    }))
    .sort((x, y) => y.sim - x.sim)
    .slice(0, k)
    .map((r) => r.c);
}

// Generate `count` questions scoped to one specialist area (a single DMBOK
// chapter). Returns fewer than `count` only if generation/verification fails
// repeatedly — the caller (start route) enforces a min-question floor and a
// supply-based cap. Empty pool → empty array (caller returns a real error).
export async function generateSpecialistExam(
  areaSlug: string,
  count: number,
): Promise<GeneratedQuestion[]> {
  const config = await getCdmpConfig();
  const area = config.knowledgeAreas.find((a) => a.slug === areaSlug);
  if (!area) {
    throw new Error(`Unknown specialist area: ${areaSlug}`);
  }

  const pool = await getChunksByChapter(area.chapter);
  if (pool.length === 0) {
    console.error(
      `[cdmp] specialist: empty pool for "${areaSlug}" (${area.chapter}) — knowledge base may not be chapter-tagged.`,
    );
    return [];
  }
  console.log(
    `[cdmp] specialist "${areaSlug}" (${area.chapter}): pool=${pool.length}, generating ${count}, concurrency ${GENERATION_CONCURRENCY}`,
  );

  const genOne = (): Promise<GeneratedQuestion | null> =>
    generateSingleQuestion(
      area.slug,
      area.label,
      area.chapter,
      sampleCoherentSet(pool, config.chunksPerQuestion),
      config,
    ).catch((err) => {
      console.error(
        `[cdmp] specialist "${areaSlug}" question failed:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    });

  const settled = await runPool(
    Array.from({ length: count }, (_, i) => i),
    GENERATION_CONCURRENCY,
    () => genOne(),
  );
  const questions = settled.filter((q): q is GeneratedQuestion => q !== null);

  for (let wave = 1; wave <= MAX_RETRY_WAVES && questions.length < count; wave++) {
    const deficit = count - questions.length;
    console.log(`[cdmp] specialist retry wave ${wave}: ${deficit} still needed`);
    const retry = await runPool(
      Array.from({ length: deficit }, (_, i) => i),
      GENERATION_CONCURRENCY,
      () => genOne(),
    );
    for (const q of retry) {
      if (q !== null && questions.length < count) questions.push(q);
    }
  }

  console.log(`[cdmp] specialist "${areaSlug}": ${questions.length}/${count}`);
  return questions;
}
