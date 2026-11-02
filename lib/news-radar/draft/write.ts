// The writing stages: thesis, steelman, essay. Rob's skills, loaded from the database,
// run in the order his workflow has always run them, each reading the one before.
// Everything that came out of the web, or out of a model that read it, goes in fenced.

import type { DraftConfig } from "./config";
import { LlmError } from "./llm";
import type { PromptInputs } from "./skills";
import { runSkill, type StageDeps } from "./stage";
import { stop, type Stop, type StepLog } from "./types";

export const THESIS_SKILL = "archos-thesis-builder";
export const STEELMAN_SKILL = "archos-steelman-checkpoint";
export const ESSAY_SKILL = "archos-ai-news-factcheck";

export interface WriterContext {
  topic: string;
  targetAudience: string;
  thesis: string;
  research: string;
  steelman: string;
  wordCount: number;
}

/** Every variable any of the writing skills uses. A skill takes what its template names. */
export function writerInputs(c: WriterContext): PromptInputs {
  return {
    plain: { target_audience: c.targetAudience, industry: "AI news", word_count: String(c.wordCount) },
    untrusted: { topic: c.topic, raw_research: c.research, thesis: c.thesis, steelman_checkpoint: c.steelman },
  };
}

export type WriteResult =
  | { ok: true; thesis: string; steelman: string; essay: string; steps: StepLog[] }
  | (Stop & { steps: StepLog[] });

export async function runWriting(
  deps: StageDeps,
  cfg: DraftConfig,
  base: { topic: string; targetAudience: string; research: string },
): Promise<WriteResult> {
  const steps: StepLog[] = [];
  const ctx: WriterContext = { ...base, thesis: "", steelman: "", wordCount: cfg.targetWords };

  const one = async (slug: string, label: string): Promise<string | Stop> => {
    try {
      const { res, step } = await runSkill(deps, { slug, label, model: cfg.models.writer, inputs: writerInputs(ctx) });
      steps.push(step);
      return res.text;
    } catch (err) {
      if (err instanceof LlmError) return stop("model_error", err.message);
      throw err;
    }
  };

  const thesis = await one(THESIS_SKILL, "thesis");
  if (typeof thesis !== "string") return { ...thesis, steps };
  ctx.thesis = thesis;
  const steelman = await one(STEELMAN_SKILL, "steelman");
  if (typeof steelman !== "string") return { ...steelman, steps };
  ctx.steelman = steelman;
  const essay = await one(ESSAY_SKILL, "essay");
  if (typeof essay !== "string") return { ...essay, steps };
  return { ok: true, thesis, steelman, essay, steps };
}
