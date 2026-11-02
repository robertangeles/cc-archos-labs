import { describe, expect, it } from "vitest";
import { extractQuotes, findUngroundedNumbers, findUnverifiedQuotes, normalizeTexts, parseEssay, prepareEvidence, runGates, wordCount, type Evidence } from "./essay";

// Every gate here exists because a model will, sooner or later, get it wrong:
// invent a quote, round a number, add a link, forget the verdict. They are plain
// checks on text, so they cost nothing and never fail open.

const SOURCE =
  'Cohere said the sandbox "had no route out" and put the unprompted rate at "less than one call in 100,000" across its runs. ' +
  "The dataset card lists Number of rows: 1 and the table shows 92% and 4.6% for the two cut points. 10M agent turns a week. " +
  "A model that is asked to finish a half-written command will finish it, because that is what the prefix demands.";
const COVERAGE = 'Qwen3.8 Picks Alibaba Cloud Domains in 40.8% of Runs. The coverage calls it a "Beijing-controlled server" reached by outbound calls.';
const EVIDENCE: Evidence = { sources: [SOURCE], coverage: COVERAGE, brief: "The brief repeats 25 of 64 as a count from the log." };

interface Over {
  title?: string;
  meta?: string;
  body?: string;
  slug?: string;
  seoTitle?: string;
  seoMeta?: string;
  tags?: string;
  verdict?: string | null;
  extraBody?: string;
}

const META_OK = "Qwen3.8 reportedly picks Alibaba Cloud domains in 40.8% of runs. Cohere's documents show other numbers, a forced condition and one trace, not 10,000 samples.";
const essay = (o: Over = {}) => {
  const meta = o.meta ?? META_OK;
  const verdict = o.verdict === undefined ? "Verdict: unproven. The 40.8% appears in no document." : o.verdict;
  const body =
    o.body ??
    `The card lists Number of rows: 1 while the coverage says 40.8%. Cohere said the sandbox "had no route out".\n\n${verdict ? verdict + "\n\n" : ""}## What the table shows\n\nThe table gives 92% and 4.6%. The unprompted rate is "less than one call in 100,000" in Cohere's own runs.\n\n${o.extraBody ?? ""}`;
  return `# ${o.title ?? "Qwen3.8's 40.8% figure is not in Cohere's data"}\n\n*${meta}*\n\n${body}\n---\n\n## SEO Package\n\n**LSI keywords used:** a, b\n**URL slug:** ${o.slug ?? "qwen38-40-8-percent-check"}\n**SEO title:** ${o.seoTitle ?? "Qwen3.8's 40.8% Figure Checked"}\n**Meta description:** ${o.seoMeta ?? meta}\n**Meta description alt 1:** x\n**Tags:** ${o.tags ?? "Qwen3.8, Cohere, Alibaba Cloud, open-weight models, prefill, AI safety"}\n`;
};
const parsed = (o: Over = {}) => parseEssay(essay(o))!;
const gates = (o: Over = {}, ev: Evidence = EVIDENCE, targetWords = 60) => runGates(parsed(o), ev, { targetWords });
const names = (f: { gate: string }[]) => f.map((x) => x.gate);

describe("parseEssay", () => {
  it("splits title, meta line, body and the SEO package", () => {
    const e = parsed();
    expect(e.title).toBe("Qwen3.8's 40.8% figure is not in Cohere's data");
    expect(e.meta).toBe(META_OK);
    expect(e.body.startsWith("The card lists")).toBe(true);
    expect(e.body).not.toContain("SEO Package");
    expect(e.body).not.toMatch(/^---\s*$/m);
    expect(e.seo).toMatchObject({ slug: "qwen38-40-8-percent-check", seoTitle: "Qwen3.8's 40.8% Figure Checked", metaDescription: META_OK });
    expect(e.seo.tags).toEqual(["Qwen3.8", "Cohere", "Alibaba Cloud", "open-weight models", "prefill", "AI safety"]);
  });

  it("returns null for text with no title", () => {
    expect(parseEssay("Just some words.\n\n## SEO Package\n\n**URL slug:** x")).toBeNull();
  });

  it("returns null for text with no italic meta line", () => {
    expect(parseEssay("# Title\n\nBody only.")).toBeNull();
  });

  it("tolerates a missing SEO package (the gates, not the parser, reject it)", () => {
    const e = parseEssay("# Title\n\n*meta line here*\n\nBody text.")!;
    expect(e.seo).toEqual({ tags: [] });
  });

  it("finds the verdict line and its word", () => {
    expect(parsed().verdict).toEqual({ word: "unproven", count: 1 });
  });

  it("reports no verdict when there is none", () => {
    expect(parsed({ verdict: null }).verdict).toEqual({ word: null, count: 0 });
  });
});

describe("gates: a clean essay passes", () => {
  it("has no failures", () => {
    expect(gates()).toEqual([]);
  });
});

describe("gates: quotes", () => {
  it("catches a quote the sources never said", () => {
    const f = gates({ extraBody: 'Cohere also admitted "the model deliberately targeted Beijing servers" in a footnote.' });
    expect(names(f)).toContain("quote");
    expect(f.find((x) => x.gate === "quote")!.detail).toContain("the model deliberately targeted Beijing servers");
  });

  it("catches a real quote with one word changed", () => {
    expect(names(gates({ extraBody: 'The rate is "less than one call in 10,000" overall.' }))).toContain("quote");
  });

  it("accepts a quote that only the headline coverage contains", () => {
    expect(names(gates({ extraBody: 'The coverage calls it a "Beijing-controlled server" without proof.' }))).not.toContain("quote");
  });

  it("ignores typography: curly quotes, dashes, case and line wraps", () => {
    expect(names(gates({ extraBody: "Cohere’s line, “HAD NO ROUTE\n out”, matters." }))).not.toContain("quote");
  });

  it("ignores trailing punctuation inside the quote marks", () => {
    expect(names(gates({ extraBody: 'It "had no route out." That is all.' }))).not.toContain("quote");
  });

  it("does not treat text inside code spans as a quote", () => {
    expect(names(gates({ extraBody: 'The command `curl -s "https://x.example/y"` is shown.' }))).not.toContain("quote");
  });
});

describe("gates: numbers", () => {
  it("catches a number found in no source", () => {
    const f = gates({ extraBody: "That is 340 customers in one week." });
    expect(names(f)).toContain("number");
    expect(f.find((x) => x.gate === "number")!.detail).toContain("340");
  });

  it("catches a rounded number", () => {
    expect(names(gates({ extraBody: "About 93% of runs did so." }))).toContain("number");
  });

  it("accepts numbers the sources hold, with or without commas and percent signs", () => {
    expect(names(gates({ extraBody: "The table gives 92% and 4.6%, and 100,000 runs, and 10M turns." }))).not.toContain("number");
  });

  it("accepts a number the research brief derived (the count)", () => {
    expect(names(gates({ extraBody: "That is 25 of 64 completions." }))).not.toContain("number");
  });
});

describe("gates: verdict", () => {
  it("requires one", () => {
    expect(names(gates({ verdict: null }))).toContain("verdict");
  });

  it("requires one of the five words", () => {
    expect(names(gates({ verdict: "Verdict: probably. Who knows." }))).toContain("verdict");
  });

  it.each(["true", "half true", "unproven", "overblown", "false"])("accepts %s", (w) => {
    expect(names(gates({ verdict: `Verdict: ${w}. One sentence of evidence.` }))).not.toContain("verdict");
  });

  it("rejects two verdict lines", () => {
    expect(names(gates({ extraBody: "Verdict: false. Again." }))).toContain("verdict");
  });
});

describe("gates: things the writer must not add", () => {
  it("rejects a leftover [Inference] tag", () => {
    expect(names(gates({ extraBody: "The count is 25 of 64 [Inference]." }))).toContain("inference");
  });

  it.each([
    ["a markdown link", "See [the card](https://huggingface.co/x) for more."],
    ["a bare URL", "See https://huggingface.co/x for more."],
  ])("rejects %s: only the pipeline writes links", (_l, extraBody) => {
    expect(names(gates({ extraBody }))).toContain("links");
  });

  it("rejects a Sources heading: the pipeline adds that section", () => {
    expect(names(gates({ extraBody: "## Sources\n\n- a thing" }))).toContain("links");
  });

  it("rejects a second em dash and any semicolon (the skill's own hard rules)", () => {
    expect(names(gates({ extraBody: "One — two — three." }))).toContain("style");
    expect(names(gates({ extraBody: "One; two." }))).toContain("style");
  });

  it("allows a single em dash", () => {
    expect(names(gates({ extraBody: "One — two." }))).not.toContain("style");
  });
});

describe("gates: length and SEO fields", () => {
  it("rejects an essay far under the target", () => {
    expect(names(gates({}, EVIDENCE, 900))).toContain("length");
  });

  it("rejects an essay far over the target", () => {
    expect(names(gates({ extraBody: "word ".repeat(400) }, EVIDENCE, 60))).toContain("length");
  });

  it("limits the SEO title to 46 characters (the template adds the brand)", () => {
    expect(names(gates({ seoTitle: "x".repeat(47) }))).toContain("seo");
    expect(names(gates({ seoTitle: "x".repeat(46) }))).not.toContain("seo");
  });

  it("wants the meta description at 150 to 160 characters", () => {
    expect(names(gates({ seoMeta: "short" }))).toContain("seo");
    expect(names(gates({ seoMeta: "x".repeat(161) }))).toContain("seo");
  });

  it("wants a clean slug", () => {
    expect(names(gates({ slug: "Not A Slug" }))).toContain("seo");
    expect(names(gates({ slug: "has_underscore" }))).toContain("seo");
  });

  it("wants 5 to 8 tags", () => {
    expect(names(gates({ tags: "one, two" }))).toContain("seo");
    expect(names(gates({ tags: "a1, b2, c3, d4, e5, f6, g7, h8, i9" }))).toContain("seo");
  });

  it("reports a missing SEO package", () => {
    const e = parseEssay("# T\n\n*" + META_OK + "*\n\nBody Verdict: x")!;
    expect(names(runGates(e, EVIDENCE, { targetWords: 60 }))).toContain("seo");
  });
});

describe("prepared evidence", () => {
  const withBadQuote = { extraBody: 'Cohere also admitted "the model deliberately targeted Beijing servers" in a footnote. That is 340 customers.' };

  it("gives the same verdicts as unprepared evidence", () => {
    const plain = gates(withBadQuote);
    const prepared = gates(withBadQuote, prepareEvidence(EVIDENCE.sources, EVIDENCE.coverage, EVIDENCE.brief));
    expect(prepared).toEqual(plain);
    expect(names(prepared)).toEqual(expect.arrayContaining(["quote", "number"]));
  });

  it("normalises the pages once, not once per quote", () => {
    const big = "word ".repeat(200_000) + SOURCE;
    const prepared = prepareEvidence([big], COVERAGE, "");
    const quotes = Array.from({ length: 30 }, (_, i) => `"had no route out" and "made up quote number ${i} here"`).join(" ");
    const t0 = Date.now();
    for (let r = 0; r < 5; r++) findUnverifiedQuotes(quotes, prepared.sources, prepared.prepared!.normalized);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("accepts normalised texts built elsewhere", () => {
    const norm = normalizeTexts(["The sandbox had no route out."]);
    expect(findUnverifiedQuotes('"had no route out" and "never said this"', ["The sandbox had no route out."], norm)).toEqual(["never said this"]);
  });
});

describe("helpers", () => {
  it("counts words", () => {
    expect(wordCount("one two\nthree   four")).toBe(4);
    expect(wordCount("")).toBe(0);
  });

  it("extracts quotes of 6 or more characters, straight and curly", () => {
    expect(extractQuotes('He said "had no route out" and “deny by default” but "no" and "ab" are too short.')).toEqual([
      "had no route out",
      "deny by default",
    ]);
  });

  it("findUnverifiedQuotes returns only the missing ones", () => {
    expect(findUnverifiedQuotes('"had no route out" and "made up words here"', [SOURCE])).toEqual(["made up words here"]);
  });

  it("findUngroundedNumbers ignores single digits and returns the rest", () => {
    expect(findUngroundedNumbers("3 tests, 92% and 777 items", SOURCE)).toEqual(["777"]);
  });
});
