import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { parseRubricConfig } from "./rubric";

// A fresh object per call so a test can mutate it without leaking.
function validConfig() {
  return {
    model: "jev-1.14.0",
    questions: {
      audience_fit: {
        instructions: "How useful is this to leaders of regulated data and AI programs?",
        criteria: ["Not relevant", "Loosely relevant", "Relevant", "Core"],
      },
    },
    cutoffs: {
      audienceFit: 2,
      confidence: 0.8,
      minNoveltyDistance: 0.25,
      dailyCap: 3,
    },
  };
}

describe("parseRubricConfig", () => {
  it("accepts a valid config and returns it unchanged", () => {
    expect(parseRubricConfig(validConfig())).toEqual(validConfig());
  });

  it("accepts a second question beside audience_fit", () => {
    const c = validConfig();
    (c.questions as Record<string, unknown>).hype = {
      instructions: "How much is this marketing?",
      criteria: ["None", "Some"],
    };
    expect(Object.keys(parseRubricConfig(c).questions)).toEqual([
      "audience_fit",
      "hype",
    ]);
  });

  it("accepts the boundary values", () => {
    const c = validConfig();
    c.cutoffs = { audienceFit: 3, confidence: 1, minNoveltyDistance: 2, dailyCap: 50 };
    expect(() => parseRubricConfig(c)).not.toThrow();
    c.cutoffs = { audienceFit: 0, confidence: 0, minNoveltyDistance: 0, dailyCap: 1 };
    expect(() => parseRubricConfig(c)).not.toThrow();
  });

  it("throws a ZodError", () => {
    expect(() => parseRubricConfig({})).toThrow(ZodError);
    expect(() => parseRubricConfig(null)).toThrow(ZodError);
  });

  it("rejects a config without audience_fit", () => {
    const c = validConfig();
    c.questions = {
      other: { instructions: "x", criteria: ["a", "b"] },
    } as unknown as typeof c.questions;
    expect(() => parseRubricConfig(c)).toThrow(/audience_fit/);
  });

  it("rejects T above the audience_fit scale", () => {
    const c = validConfig(); // 4 levels, so the top level is 3
    c.cutoffs.audienceFit = 3.5;
    expect(() => parseRubricConfig(c)).toThrow(/audienceFit/);
    c.cutoffs.audienceFit = 4;
    expect(() => parseRubricConfig(c)).toThrow(/audienceFit/);
  });

  it("rejects a negative T", () => {
    const c = validConfig();
    c.cutoffs.audienceFit = -1;
    expect(() => parseRubricConfig(c)).toThrow(ZodError);
  });

  it.each([-0.1, 1.1, Number.NaN])("rejects confidence %s", (confidence) => {
    const c = validConfig();
    c.cutoffs.confidence = confidence;
    expect(() => parseRubricConfig(c)).toThrow(ZodError);
  });

  it.each([-0.1, 2.1])("rejects minNoveltyDistance %s", (minNoveltyDistance) => {
    const c = validConfig();
    c.cutoffs.minNoveltyDistance = minNoveltyDistance;
    expect(() => parseRubricConfig(c)).toThrow(ZodError);
  });

  it.each([0, 51, 2.5])("rejects dailyCap %s", (dailyCap) => {
    const c = validConfig();
    c.cutoffs.dailyCap = dailyCap;
    expect(() => parseRubricConfig(c)).toThrow(ZodError);
  });

  it("rejects unknown keys at every level", () => {
    const top = { ...validConfig(), extra: 1 };
    expect(() => parseRubricConfig(top)).toThrow(ZodError);

    const cutoffs = validConfig();
    (cutoffs.cutoffs as Record<string, unknown>).extra = 1;
    expect(() => parseRubricConfig(cutoffs)).toThrow(ZodError);

    const question = validConfig();
    (question.questions.audience_fit as Record<string, unknown>).type = "score";
    expect(() => parseRubricConfig(question)).toThrow(ZodError);
  });

  it.each(["jev-latest", "jev-1.14", "jev-1.14.0-beta", "gpt-4", "", " jev-1.14.0"])(
    "rejects model %j",
    (model) => {
      const c = validConfig();
      c.model = model;
      expect(() => parseRubricConfig(c)).toThrow(ZodError);
    },
  );

  it("rejects fewer than two criteria", () => {
    const c = validConfig();
    c.questions.audience_fit.criteria = ["only one"];
    c.cutoffs.audienceFit = 0;
    expect(() => parseRubricConfig(c)).toThrow(ZodError);
  });

  it("rejects more than ten criteria", () => {
    const c = validConfig();
    c.questions.audience_fit.criteria = Array.from({ length: 11 }, (_, i) => `level ${i}`);
    expect(() => parseRubricConfig(c)).toThrow(ZodError);
  });

  it("rejects empty or oversized text", () => {
    const empty = validConfig();
    empty.questions.audience_fit.criteria = ["ok", ""];
    expect(() => parseRubricConfig(empty)).toThrow(ZodError);

    const longCriterion = validConfig();
    longCriterion.questions.audience_fit.criteria = ["ok", "x".repeat(501)];
    expect(() => parseRubricConfig(longCriterion)).toThrow(ZodError);

    const noInstructions = validConfig();
    noInstructions.questions.audience_fit.instructions = "";
    expect(() => parseRubricConfig(noInstructions)).toThrow(ZodError);

    const longInstructions = validConfig();
    longInstructions.questions.audience_fit.instructions = "x".repeat(2001);
    expect(() => parseRubricConfig(longInstructions)).toThrow(ZodError);
  });

  it("rejects question ids that are not snake_case and never passes __proto__ through", () => {
    // JSON.parse makes __proto__ an own key, as a hostile stored config would.
    // zod drops that key before it reaches the output rather than failing.
    const proto = JSON.parse(
      JSON.stringify(validConfig()).replace(
        '"audience_fit":',
        '"__proto__":{"instructions":"x","criteria":["a","b"]},"audience_fit":',
      ),
    );
    expect(Object.hasOwn(parseRubricConfig(proto).questions, "__proto__")).toBe(false);

    const spaced = validConfig();
    (spaced.questions as Record<string, unknown>)["Audience Fit"] = {
      instructions: "x",
      criteria: ["a", "b"],
    };
    expect(() => parseRubricConfig(spaced)).toThrow(ZodError);
  });
});
