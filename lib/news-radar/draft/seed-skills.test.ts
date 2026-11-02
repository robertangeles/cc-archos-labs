import { describe, expect, it } from "vitest";
import { createSkillSchema } from "../../skills/validation";
import { parseJudge } from "./tighten";
import { buildPrompt } from "./skills";
import { deriveFactcheckSkill, FACTCHECK_SLUG, NEWS_SKILLS, SeedDerivationError, SLOP_DEFINITION, SUPPLIED } from "./seed-skills";

const placeholders = (s: string | null) => [...new Set([...(s ?? "").matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];

// A trimmed copy of the structure of Rob's Paul Graham skill: the three anchors the
// derivation edits, the placeholders it uses, and surrounding text that must survive.
const PG_TEMPLATE = `Write like Paul Graham.

Topic: {{topic}}
Thesis: {{thesis}}
Research: {{raw_research}}
Steelman: {{steelman_checkpoint}}
Target audience: {{target_audience}}
Word count (MANDATORY): {{word_count}}

---

## Voice and Style

- Write like a smart person thinking.

---

## Intentional Imperfection

- Include one irrational bias. Name a specific vendor you dislike, or a war story where you looked foolish.
- Write one slightly awkward sentence.

---

## Sentence and paragraph structure

- Vary sentence length.

---

## Output Structure (MANDATORY — follow exactly)

# Title

*Meta description here*

[Hook paragraph — no header]

## [Section header]

---

## Evidence Rules (HARD)

1. Every figure must appear verbatim in the research.
- Label inferences explicitly. If a conclusion is not directly stated in the source, mark it [Inference].
3. Never claim personal experience.`;
const PG = {
  template: PG_TEMPLATE,
  system: "You are a PhD-level writer. Every claim traces to `{{raw_research}}`.",
  inputs: [{ key: "thesis", type: "text" as const, label: "Thesis", required: true }],
  outputs: [{ key: "article_draft", type: "markdown" as const, label: "Result" }],
};

describe("the seeded skills", () => {
  it.each(NEWS_SKILLS.map((s) => [s.slug, s] as const))("%s uses only variables its stage supplies", (slug, s) => {
    for (const v of [...placeholders(s.template), ...placeholders(s.system)]) {
      expect(SUPPLIED[slug], `${slug} uses {{${v}}}`).toContain(v);
    }
  });

  it.each(NEWS_SKILLS.map((s) => [s.slug, s] as const))("%s is a valid skill as the app defines one", (_slug, s) => {
    const parsed = createSkillSchema.safeParse({
      name: s.name,
      description: s.description,
      category: s.category,
      promptTemplate: s.template,
      systemPrompt: s.system ?? undefined,
      defaultModel: s.defaultModel,
      maxTokens: s.maxTokens,
      inputs: s.inputs,
      outputs: s.outputs,
    });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it.each(NEWS_SKILLS.map((s) => [s.slug, s] as const))("%s declares an input for every variable it uses", (_slug, s) => {
    const declared = s.inputs.map((i) => i.key);
    for (const v of placeholders(s.template)) expect(declared).toContain(v);
  });

  it("each template builds with exactly what its stage supplies, and nothing is left unfilled", () => {
    for (const s of NEWS_SKILLS) {
      const vars = Object.fromEntries(SUPPLIED[s.slug].map((k) => [k, `<${k}>`]));
      const { user } = buildPrompt({ slug: s.slug, system: s.system, template: s.template, temperature: null, maxTokens: null }, { plain: vars });
      expect(user).not.toMatch(/\{\{/);
      for (const k of placeholders(s.template)) expect(user).toContain(`<${k}>`);
    }
  });

  it("the judge carries Rob's definition verbatim and asks his question", () => {
    const judge = NEWS_SKILLS.find((s) => s.slug === "archos-slop-judge")!;
    expect(judge.system).toContain(SLOP_DEFINITION);
    expect(SLOP_DEFINITION).toMatch(/^To define AI Slop cleanly:/);
    expect(SLOP_DEFINITION).toMatch(/perfectly polished PowerPoint deck/);
    expect(SLOP_DEFINITION).toContain("Ghost Specificity");
    expect(judge.template).toMatch(/^Is this AI Slop\?/);
    expect(judge.defaultModel).toBe("deepseek/deepseek-v4-flash-0731");
  });

  it("the judge's own format is one the loop can read", () => {
    const reply = "Verdict: not slop\n\nWhat works:\n- The forensic chain.\n\nWhat to tighten:\n1. \"Whichever percentage turns out right\" is compressed. Say what is meant.\n2. The 4.6% arrives without setup.";
    expect(parseJudge(reply)).toEqual({
      verdict: "not_slop",
      tighten: ['"Whichever percentage turns out right" is compressed. Say what is meant.', "The 4.6% arrives without setup."],
    });
  });

  it("the research brief tells the model to copy quotes exactly and to use only the documents", () => {
    const brief = NEWS_SKILLS.find((s) => s.slug === "archos-news-research-brief")!;
    expect(brief.template).toMatch(/copied EXACTLY/);
    expect(brief.template).toMatch(/ONLY the documents/);
    expect(brief.template).toMatch(/NOT in any document/);
  });

  it("the photo skill forbids faces, printed text and numbers, and asks for alt text", () => {
    const photo = NEWS_SKILLS.find((s) => s.slug === "archos-editorial-photo")!;
    expect(photo.template).toMatch(/No faces/);
    expect(photo.template).toMatch(/numerals/);
    expect(photo.template).toMatch(/Alt Text:/);
  });
});

describe("deriveFactcheckSkill", () => {
  const derived = () => deriveFactcheckSkill(PG);

  it("removes the Intentional Imperfection block and nothing around it", () => {
    const t = derived().template;
    expect(t).not.toContain("Intentional Imperfection");
    expect(t).not.toContain("irrational bias");
    expect(t).toContain("## Voice and Style");
    expect(t).toContain("## Sentence and paragraph structure");
    expect(t).toContain("## Evidence Rules (HARD)");
    expect(t).toContain("Never claim personal experience.");
  });

  it("adds the verdict rules before the output structure and the verdict slot after the hook", () => {
    const t = derived().template;
    expect(t.indexOf("## Verdict (MANDATORY)")).toBeGreaterThan(-1);
    expect(t.indexOf("## Verdict (MANDATORY)")).toBeLessThan(t.indexOf("## Output Structure"));
    expect(t.indexOf("[Hook paragraph — no header]")).toBeLessThan(t.indexOf("Verdict: [true | half true | unproven | overblown | false]."));
    expect(t).toContain("Every piece gives a verdict on the headline, stated once, directly after the hook paragraph.");
    expect(t).not.toContain("ends its argument in a verdict");
  });

  it("asks for inferences in words, not a bracket tag the checks would reject", () => {
    const t = derived().template;
    expect(t).not.toContain("mark it [Inference]");
    expect(t).toContain('write "I infer" or "my reading is"');
    expect(t).toContain("Never use a bracket tag");
  });

  it("changes only those four things", () => {
    const lines = (s: string) => new Set(s.split("\n"));
    const before = lines(PG_TEMPLATE);
    const after = lines(derived().template);
    const removed = [...before].filter((l) => !after.has(l)).filter((l) => l.trim());
    expect(removed.every((l) => /irrational bias|awkward sentence|Intentional Imperfection|Label inferences/.test(l))).toBe(true);
  });

  it("keeps the source's system prompt, inputs and outputs", () => {
    const d = derived();
    expect(d.system).toBe(PG.system);
    expect(d.inputs).toEqual(PG.inputs);
    expect(d.outputs).toEqual(PG.outputs);
    expect(d.slug).toBe(FACTCHECK_SLUG);
  });

  it("uses only variables the writing stages supply", () => {
    for (const v of placeholders(derived().template)) expect(SUPPLIED[FACTCHECK_SLUG]).toContain(v);
  });

  it.each([
    ["the Imperfection block", PG_TEMPLATE.replace(/## Intentional Imperfection[\s\S]*?(?=## Sentence)/, "")],
    ["the Output Structure heading", PG_TEMPLATE.replace("## Output Structure (MANDATORY — follow exactly)", "## Output")],
    ["the hook line", PG_TEMPLATE.replace("[Hook paragraph — no header]\n", "")],
    ["the inference rule", PG_TEMPLATE.replace("mark it [Inference]", "mark it as an inference")],
  ])("refuses to derive when %s is gone, instead of making a half-changed copy", (_l, template) => {
    expect(() => deriveFactcheckSkill({ ...PG, template })).toThrow(SeedDerivationError);
  });
});
