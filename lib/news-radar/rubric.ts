import { z } from "zod";

// News-radar rubric (CEO plan D13, E3-E5): the Jev model pin, the scored
// questions and the cut-offs, validated before a version is stored and again
// before a tick uses it.
//
// Self-contained on purpose: scripts/radar-rubric-set.mjs imports this file
// directly under Node's type stripping, so it may only use erasable TypeScript
// syntax (no enums, namespaces or parameter properties) and no relative imports.

// Exact version, never an alias like "jev-latest": a score must name the model that made it.
const MODEL = /^jev-\d+\.\d+\.\d+$/;
// Becomes the answer id on the wire and in score rows; also rules out "__proto__".
const QUESTION_ID = /^[a-z][a-z0-9_]{0,63}$/;

const QuestionSchema = z
  .object({
    instructions: z.string().min(1).max(2000),
    // Level numbers are array positions starting at 0.
    criteria: z.array(z.string().min(1).max(500)).min(2).max(10),
  })
  .strict();

export const RubricConfigSchema = z
  .object({
    model: z.string().regex(MODEL),
    questions: z.record(z.string().regex(QUESTION_ID), QuestionSchema),
    cutoffs: z
      .object({
        // T: minimum audience_fit score; checked against the scale below.
        audienceFit: z.number().min(0),
        // C: minimum confidence on that score.
        confidence: z.number().min(0).max(1),
        // M: minimum cosine distance from the nearest published post to count as novel.
        minNoveltyDistance: z.number().min(0).max(2),
        // N: how many items the page shows per day; display only.
        dailyCap: z.number().int().min(1).max(50),
      })
      .strict(),
  })
  .strict()
  .refine((c) => Object.hasOwn(c.questions, "audience_fit"), {
    path: ["questions", "audience_fit"],
    error: "questions must include audience_fit",
  })
  .refine(
    (c) => {
      const q = c.questions.audience_fit;
      return !q || c.cutoffs.audienceFit <= q.criteria.length - 1;
    },
    {
      path: ["cutoffs", "audienceFit"],
      error: "audienceFit must not exceed the top level of the audience_fit scale",
    },
  );

export type RubricConfig = z.infer<typeof RubricConfigSchema>;

/** @throws ZodError when the input is not a valid rubric. */
export function parseRubricConfig(input: unknown): RubricConfig {
  return RubricConfigSchema.parse(input);
}
