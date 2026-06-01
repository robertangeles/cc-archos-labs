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

export async function generateQuestionBatch(
  chapters: ChapterDistribution[],
): Promise<GeneratedQuestion[]> {
  const config = await getCdmpConfig();
  const questions: GeneratedQuestion[] = [];

  for (const chapter of chapters) {
    if (chapter.questionCount === 0) continue;

    console.log(
      `[cdmp] Generating ${chapter.questionCount} question(s) for: ${chapter.label}`,
    );

    for (let i = 0; i < chapter.questionCount; i++) {
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
          continue;
        }

        const question = await generateSingleQuestion(
          chapter.slug,
          chapter.label,
          chapter.chapter,
          chunks,
          config,
        );

        if (question) {
          console.log(
            `[cdmp] OK: "${chapter.label}" q${i + 1}/${chapter.questionCount}`,
          );
          questions.push(question);
        } else {
          console.log(
            `[cdmp] FAIL: "${chapter.label}" q${i + 1}/${chapter.questionCount}`,
          );
        }
      } catch (err) {
        console.error(
          `[cdmp] ERROR "${chapter.label}" q${i + 1}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  console.log(`[cdmp] Total generated: ${questions.length}`);
  return questions;
}
