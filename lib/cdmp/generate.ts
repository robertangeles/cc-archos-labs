import "server-only";
import { generateStructured } from "@/lib/claude";
import { searchKnowledge, type SearchResult } from "@/lib/knowledge/search";
import { getCdmpConfig } from "./config";
import type { ChapterDistribution } from "./weights";
import type { CdmpConfig } from "./config-shared";

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

SOURCE TEXT (from DMBOK):
${sourceText}`,
        maxTokens: config.generationMaxTokens,
      });

      const q = genResult.data;

      const verResult = await generateStructured<VerificationOutput>({
        systemPrompt: config.verificationPrompt,
        userMessage: `SOURCE TEXT (from DMBOK):
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

      return {
        questionText: q.question,
        options: [
          { code: "A", label: q.options.A },
          { code: "B", label: q.options.B },
          { code: "C", label: q.options.C },
          { code: "D", label: q.options.D },
          { code: "E", label: q.options.E },
        ],
        correctAnswer: q.correct_answer,
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

export async function generateQuestionBatch(
  chapters: ChapterDistribution[],
): Promise<GeneratedQuestion[]> {
  const config = await getCdmpConfig();

  // Flatten the per-chapter distribution into one task per question so
  // every question can run concurrently regardless of which chapter it
  // belongs to.
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
    async ({ chapter, i }) => {
      try {
        const chunks = await searchKnowledge(
          chapter.label,
          "dmbok",
          config.chunksPerQuestion,
        );

        if (chunks.length === 0) {
          console.log(
            `[cdmp] SKIP: no chunks found for "${chapter.label}" (q${i + 1})`,
          );
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
          `[cdmp] ${question ? "OK" : "FAIL"}: "${chapter.label}" q${i + 1}/${chapter.questionCount}`,
        );
        return question;
      } catch (err) {
        console.error(
          `[cdmp] ERROR "${chapter.label}" q${i + 1}:`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    },
  );

  const questions = settled.filter(
    (q): q is GeneratedQuestion => q !== null,
  );

  console.log(
    `[cdmp] Total generated: ${questions.length}/${tasks.length}`,
  );
  return questions;
}
