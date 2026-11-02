import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResult, Llm } from "./llm";
import { LlmError } from "./llm";
import { DEFAULT_DRAFT_CONFIG } from "./config";
import type { Evidence } from "./essay";
import type { SkillPrompt } from "./skills";
import { filterNotes, parseJudge, tightenEssay, type WriterContext } from "./tighten";

// The tighten loop is the part that turns a judge's review into a better essay. What
// matters most is what it does NOT pass on: a note about a typo that is not there, a
// "verify before publication" chore, or a rewrite that quietly breaks a quote.

const chat = (text: string): ChatResult => ({ text, model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.01, citations: [], durationMs: 3 });
const seq = (replies: Record<string, (ChatResult | Error)[]>) => {
  const calls: ChatRequest[] = [];
  const left = Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, [...v]]));
  const llm: Llm = async (req) => {
    calls.push(req);
    const q = left[req.label];
    if (!q || q.length === 0) throw new Error(`unexpected llm call: ${req.label}`);
    const r = q.shift()!;
    if (r instanceof Error) throw r;
    return r;
  };
  return { llm, calls };
};

const WRITER: SkillPrompt = {
  slug: "archos-ai-news-factcheck",
  system: "Write.",
  template: "Topic: {{topic}}\nThesis: {{thesis}}\nResearch: {{raw_research}}\nSteelman: {{steelman_checkpoint}}\nAudience: {{target_audience}}\nWords: {{word_count}}",
  temperature: null,
  maxTokens: null,
};
const JUDGE: SkillPrompt = { slug: "archos-slop-judge", system: "Judge.", template: "Is this AI Slop?\n\n{{article}}", temperature: null, maxTokens: null };
const skill = async (slug: string) => (slug === "archos-slop-judge" ? JUDGE : WRITER);

const SOURCE = 'Cohere said the sandbox "had no route out" and put the rate at "less than one call in 100,000". The table shows 92% and 4.6%.';
const EVIDENCE: Evidence = { sources: [SOURCE], coverage: "Qwen3.8 Picks Alibaba Cloud Domains in 40.8% of Runs.", brief: "" };
const META = "Qwen3.8 reportedly picks Alibaba Cloud domains in 40.8% of runs. Cohere's documents show other numbers, a forced condition and one trace, not 10,000 samples.";
const ctx: WriterContext = { topic: "Behind the AI Headline: Qwen", targetAudience: "Readers", thesis: "T", research: "R", steelman: "S", wordCount: 60 };

const essay = (extra = "", verdict = "Verdict: unproven. The 40.8% appears in no document.") =>
  `# Qwen3.8's 40.8% figure is not in Cohere's data\n\n*${META}*\n\nCohere said the sandbox "had no route out" and the table shows 92% and 4.6%.\n\n${verdict}\n\n## What the table shows\n\nThe unprompted rate is "less than one call in 100,000" in Cohere's own runs. ${extra}\n---\n\n## SEO Package\n\n**URL slug:** qwen38-check\n**SEO title:** Qwen3.8's 40.8% Figure Checked\n**Meta description:** ${META}\n**Tags:** Qwen3.8, Cohere, Alibaba Cloud, open-weight models, prefill, AI safety\n`;
const GOOD = essay();
const FABRICATED = essay('Cohere also admitted "the model deliberately targeted Beijing servers" in a footnote.');

const CLEAN = "Verdict: not slop\n\nWhat works:\n- Specific figures.\n\nWhat to tighten:\nNothing to tighten.";
const NOTES = `Verdict: not slop\n\nWhat works:\n- Specific.\n\nWhat to tighten:\n1. Density. The sentence "Cohere said the sandbox" is compressed past first-read comprehension.\n2. Verify before publication: confirm the 4.6% figure.\n3. A typo: "The sighting arrive secondhand" should be corrected.`;
const SLOP = 'Verdict: slop\n\nWhat works:\n- nothing\n\nWhat to tighten:\n1. Ghost specificity: "Number of rows: 1" is name-dropping.';

const run = (llm: Llm, first: string, over: Partial<typeof DEFAULT_DRAFT_CONFIG> = {}) =>
  tightenEssay({ llm, skill }, { ...DEFAULT_DRAFT_CONFIG, targetWords: 60, ...over }, { firstDraft: first, evidence: EVIDENCE, writer: ctx });

describe("parseJudge", () => {
  it("reads the strict format", () => {
    const r = parseJudge(NOTES)!;
    expect(r.verdict).toBe("not_slop");
    expect(r.tighten).toHaveLength(3);
    expect(r.tighten[0]).toMatch(/^Density\./);
  });

  it("reads Nothing to tighten as an empty list", () => {
    expect(parseJudge(CLEAN)).toEqual({ verdict: "not_slop", tighten: [] });
  });

  it("reads slop", () => {
    expect(parseJudge(SLOP)!.verdict).toBe("slop");
  });

  it.each([
    ["Verdict: Absolutely NOT AI Slop. This is top tier.", "not_slop"],
    ["**Verdict:** not AI slop. It may be AI-assisted, but by your criteria it passes.", "not_slop"],
    ["Verdict: Yes, this is AI slop.", "slop"],
    ["Verdict: slop. Not a close call.", "slop"],
    ["No, this is the opposite of AI slop by the definition you gave.\n\nIt is dense.", "not_slop"],
  ])("reads the verdict in %j", (text, expected) => {
    expect(parseJudge(text)!.verdict).toBe(expected);
  });

  it("returns null when it cannot tell", () => {
    expect(parseJudge("It reads fine to me, honestly.")).toBeNull();
    expect(parseJudge("")).toBeNull();
  });

  it("reads the format you actually get from DeepSeek: prose, a markdown heading, numbered notes with sub-lines", () => {
    const real = `Verdict: Absolutely NOT AI Slop. This is top tier.\n\nWhat works:\n\n1. The forensic chain is specific at every link.\n\nWhat to tighten:\n\n1. The density is at the edge of readability.\n\nThis piece assumes a reader who will go back and re-read:\n\n"The behavior also surfaced before Cohere's controlled work."\n"Whichever percentage turns out right, the response is the same."\n\nOne structural fix would help: a short opening paragraph.\n\n2. The [Inference] tags read as notes.\n\nConsider an inline parenthetical.\n\n3. Two figures arrive without setup.\n\nThe 4.6% appears in the verdict line first.\n\n4. Verify before publication.\n\nConfirm the figures.`;
    const r = parseJudge(real)!;
    expect(r.verdict).toBe("not_slop");
    expect(r.tighten).toHaveLength(4);
    expect(r.tighten[0]).toContain("Whichever percentage turns out right");
    expect(r.tighten[3]).toMatch(/Verify before publication/);
  });

  it.each(["## What to tighten", "**What to tighten**", "What to tighten:", "WHAT TO TIGHTEN"])("finds the heading written as %s", (h) => {
    expect(parseJudge(`Verdict: not slop\n\n${h}\n\n1. Cut the second paragraph, it repeats the first.`)!.tighten).toHaveLength(1);
  });

  it("reads bullets as well as numbers, and strips bold", () => {
    const r = parseJudge("Verdict: not slop\n\nWhat to tighten:\n- **Density.** Split the long sentence in paragraph two.\n- Cut the closing line.");
    expect(r!.tighten).toEqual(["Density. Split the long sentence in paragraph two.", "Cut the closing line."]);
  });

  it("stops the tighten list at the next section", () => {
    const r = parseJudge("Verdict: not slop\n\nWhat to tighten:\n1. Cut a line from paragraph two.\n\nWhat works:\n- the ending");
    expect(r!.tighten).toEqual(["Cut a line from paragraph two."]);
  });
});

describe("filterNotes", () => {
  const body = 'The behavior also surfaced before the test. Whichever percentage is right, the response is the same. The sightings arrive secondhand.';

  it("drops a verification chore", () => {
    const r = filterNotes(["Verify before publication. Confirm the figures against the primary documents."], body);
    expect(r.keep).toEqual([]);
    expect(r.dropped[0].why).toBe("verification");
  });

  it("drops a claim about text that is not in the essay", () => {
    const r = filterNotes(['A typo: "The sighting arrive secondhand, the threads were not fetched" should be fixed.'], body);
    expect(r.keep).toEqual([]);
    expect(r.dropped[0].why).toBe("unfounded");
  });

  it("keeps the good lines of a note and drops only the line that quotes nothing real", () => {
    const note = `Density at the edge of readability.\n"The behavior also surfaced before the test."\n"The sighting arrive secondhand, the threads were not fetched" (typo)`;
    const r = filterNotes([note], body);
    expect(r.keep).toHaveLength(1);
    expect(r.keep[0]).toContain("The behavior also surfaced before the test.");
    expect(r.keep[0]).not.toContain("sighting arrive");
  });

  it("keeps a note that quotes nothing (a structural suggestion)", () => {
    expect(filterNotes(["Open with a short paragraph that states the three findings."], body).keep).toHaveLength(1);
  });

  it("matches quotes through curly quotes, case and spacing", () => {
    const r = filterNotes(["Tighten “WHICHEVER percentage is right,\nthe response is the same”."], body);
    expect(r.keep).toHaveLength(1);
  });

  it("ignores very short quoted words (they prove nothing either way)", () => {
    expect(filterNotes(['Replace "very" and "just" where they appear.'], body).keep).toHaveLength(1);
  });

  it("reports what it dropped so a person can see it", () => {
    const r = filterNotes(["Verify before publication.", "Open with the findings."], body);
    expect(r.keep).toHaveLength(1);
    expect(r.dropped).toHaveLength(1);
  });
});

describe("tightenEssay", () => {
  it("passes a clean first draft with no rewrite", async () => {
    const { llm, calls } = seq({ judge_1: [chat(CLEAN)] });
    const r = await run(llm, GOOD);
    expect(r).toMatchObject({ ok: true, rewrites: 0 });
    expect(calls.map((c) => c.label)).toEqual(["judge_1"]);
  });

  it("uses the judge model and the user's judge skill, with the article fenced", async () => {
    const { llm, calls } = seq({ judge_1: [chat(CLEAN)] });
    await run(llm, GOOD);
    expect(calls[0].model).toBe(DEFAULT_DRAFT_CONFIG.models.judge);
    expect(calls[0].user).toMatch(/^Is this AI Slop\?/);
    expect(calls[0].user).toMatch(/<<<UNTRUSTED_/);
    expect(calls[0].user).not.toContain("SEO Package"); // the judge reads the article, not the SEO fields
  });

  it("rewrites once with the judge's notes, then passes", async () => {
    const improved = essay("A shorter closing line.");
    const { llm, calls } = seq({ judge_1: [chat(NOTES)], rewrite_1: [chat(improved)], judge_2: [chat(CLEAN)] });
    const r = await run(llm, GOOD);
    expect(r).toMatchObject({ ok: true, rewrites: 1 });
    if (r.ok) expect(r.essayText).toBe(improved);
    expect(calls.map((c) => c.label)).toEqual(["judge_1", "rewrite_1", "judge_2"]);
  });

  it("gives the writer the real notes and the previous draft, fenced, and leaves out the chores and the false typo", async () => {
    const { llm, calls } = seq({ judge_1: [chat(NOTES)], rewrite_1: [chat(essay("x"))], judge_2: [chat(CLEAN)] });
    await run(llm, GOOD);
    const rw = calls.find((c) => c.label === "rewrite_1")!;
    expect(rw.user).toContain("Density.");
    expect(rw.user).not.toContain("Verify before publication");
    expect(rw.user).not.toContain("sighting arrive");
    expect(rw.user).toContain("# Qwen3.8's 40.8% figure"); // the previous draft is there
    const marker = /<<<(UNTRUSTED_[0-9a-f-]+)\n/.exec(rw.user)![1];
    expect(rw.system).toContain(marker);
    expect(rw.model).toBe(DEFAULT_DRAFT_CONFIG.models.writer);
  });

  it("rewrites for a failed check BEFORE spending a judge call, and says what failed", async () => {
    const { llm, calls } = seq({ rewrite_1: [chat(GOOD)], judge_1: [chat(CLEAN)] });
    const r = await run(llm, FABRICATED);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.label)).toEqual(["rewrite_1", "judge_1"]);
    expect(calls[0].user).toContain("the model deliberately targeted Beijing servers");
  });

  it("tells the rewriter what to do with an [Inference] tag, since the skill itself asks for the tag", async () => {
    const tagged = essay("The count is 25 of 64 [Inference].");
    const { llm, calls } = seq({ rewrite_1: [chat(GOOD)], judge_1: [chat(CLEAN)] });
    const r = await run(llm, tagged);
    expect(r.ok).toBe(true);
    expect(calls[0].user).toContain("delete the tag and say in the sentence, in words, that it is your inference"); // the standing instruction
    expect(calls[0].user).toContain("inference: a [Inference] tag is left in the text: delete the tag"); // the failed check, with the fix
  });

  it("stops with failed_gates when the checks still fail after the allowed rewrites", async () => {
    const { llm, calls } = seq({ rewrite_1: [chat(FABRICATED)], rewrite_2: [chat(FABRICATED)] });
    const r = await run(llm, FABRICATED);
    expect(r).toMatchObject({ ok: false, reason: "failed_gates" });
    if (!r.ok) expect(r.detail).toContain("deliberately targeted");
    expect(calls.map((c) => c.label)).toEqual(["rewrite_1", "rewrite_2"]);
  });

  it("stops with slop_verdict when the judge still says slop after the allowed rewrites", async () => {
    const { llm } = seq({ judge_1: [chat(SLOP)], rewrite_1: [chat(GOOD)], judge_2: [chat(SLOP)], rewrite_2: [chat(GOOD)], judge_3: [chat(SLOP)] });
    expect(await run(llm, GOOD)).toMatchObject({ ok: false, reason: "slop_verdict" });
  });

  it("accepts a draft the judge calls not slop even if advisory notes remain after the allowed rewrites", async () => {
    const { llm } = seq({ judge_1: [chat(NOTES)], rewrite_1: [chat(GOOD)], judge_2: [chat(NOTES)], rewrite_2: [chat(GOOD)], judge_3: [chat(NOTES)] });
    const r = await run(llm, GOOD);
    expect(r).toMatchObject({ ok: true, rewrites: 2 });
    if (r.ok) expect(r.unresolvedNotes.length).toBeGreaterThan(0);
  });

  it("never rewrites when the allowance is zero: clean passes, a failure stops", async () => {
    const a = seq({ judge_1: [chat(CLEAN)] });
    expect(await run(a.llm, GOOD, { maxRewrites: 0 })).toMatchObject({ ok: true, rewrites: 0 });
    const b = seq({});
    expect(await run(b.llm, FABRICATED, { maxRewrites: 0 })).toMatchObject({ ok: false, reason: "failed_gates" });
  });

  it("retries a judge answer it cannot read once, then continues", async () => {
    const { llm, calls } = seq({ judge_1: [chat("Hmm, hard to say."), chat(CLEAN)] });
    expect(await run(llm, GOOD)).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("stops with judge_failed when the judge stays unreadable", async () => {
    const { llm } = seq({ judge_1: [chat("shrug"), chat("shrug")] });
    expect(await run(llm, GOOD)).toMatchObject({ ok: false, reason: "judge_failed" });
  });

  it("treats a rewrite that cannot be read as a failed check, not a crash", async () => {
    const { llm } = seq({ judge_1: [chat(NOTES)], rewrite_1: [chat("I could not do that.")], rewrite_2: [chat("Still no.")] });
    expect(await run(llm, GOOD)).toMatchObject({ ok: false, reason: "failed_gates" });
  });

  it("catches a rewrite that breaks a quote the first draft had right", async () => {
    const { llm } = seq({ judge_1: [chat(NOTES)], rewrite_1: [chat(FABRICATED)], rewrite_2: [chat(GOOD)], judge_2: [chat(CLEAN)] });
    const r = await run(llm, GOOD);
    expect(r).toMatchObject({ ok: true, rewrites: 2 });
  });

  it("turns a model failure into a stop", async () => {
    const { llm } = seq({ judge_1: [chat(NOTES)], rewrite_1: [new LlmError("rewrite_1: model service returned 402", "client", 402)] });
    expect(await run(llm, GOOD)).toMatchObject({ ok: false, reason: "model_error" });
  });

  it("records a step for every call it made", async () => {
    const { llm } = seq({ judge_1: [chat(NOTES)], rewrite_1: [chat(essay("x"))], judge_2: [chat(CLEAN)] });
    const r = await run(llm, GOOD);
    expect(r.steps.map((s) => s.stepKey)).toEqual(["judge_1", "rewrite_1", "judge_2"]);
    expect(r.steps.every((s) => s.status === "ok")).toBe(true);
  });
});
