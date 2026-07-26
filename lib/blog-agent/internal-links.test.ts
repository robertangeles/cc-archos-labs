import { describe, expect, it } from "vitest";
import { anchorPhrases, insertInternalLinks } from "./internal-links";

const CANDIDATES = [
  { slug: "five-data-quality-signs", title: "Five Data Quality Signs Executives Can Spot" },
  { slug: "shadow-ai-inside-your-team", title: "Shadow AI Is Already Inside Your Team" },
  { slug: "what-master-data-costs", title: "What Master Data Actually Costs You" },
];

describe("anchorPhrases", () => {
  it("prefers longer phrases", () => {
    const p = anchorPhrases("Five Data Quality Signs Executives Can Spot");
    expect(p[0].split(" ").length).toBe(4);
    expect(p).toContain("data quality");
  });

  it("never starts or ends on a stopword", () => {
    // "the data" and "data of" read as broken links rather than references.
    for (const phrase of anchorPhrases("The Cost of a Data Problem in Your Team")) {
      const words = phrase.split(" ");
      expect(words[0], phrase).not.toBe("the");
      expect(words[0], phrase).not.toBe("of");
      expect(words[words.length - 1], phrase).not.toBe("of");
      expect(words[words.length - 1], phrase).not.toBe("your");
    }
  });

  it("emits no single words — a one-word anchor looks spun", () => {
    for (const phrase of anchorPhrases("Shadow AI Is Already Inside Your Team")) {
      expect(phrase.split(" ").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("survives punctuation and returns nothing for an unusable title", () => {
    expect(anchorPhrases("Data Quality: A Guide!")).toContain("data quality");
    expect(anchorPhrases("Of The And")).toEqual([]);
    expect(anchorPhrases("")).toEqual([]);
  });
});

describe("insertInternalLinks", () => {
  it("links a phrase that is already in the body", () => {
    const body = "Most teams discover their data quality problem in a meeting.";
    const { contentMd, inserted } = insertInternalLinks(body, CANDIDATES);
    expect(contentMd).toContain("[data quality](/blog/five-data-quality-signs)");
    expect(inserted).toEqual([
      { slug: "five-data-quality-signs", anchor: "data quality" },
    ]);
  });

  it("keeps the body's own casing so the anchor reads as part of the sentence", () => {
    const body = "Data Quality is the problem here.";
    const { contentMd } = insertInternalLinks(body, CANDIDATES);
    expect(contentMd).toContain("[Data Quality](/blog/five-data-quality-signs)");
  });

  it("returns the body untouched when nothing matches", () => {
    // A normal outcome: the writer did not know these posts existed.
    const body = "A paragraph about something else entirely, at some length.";
    const { contentMd, inserted } = insertInternalLinks(body, CANDIDATES);
    expect(contentMd).toBe(body);
    expect(inserted).toEqual([]);
  });

  it("caps the number of links", () => {
    const body = [
      "One paragraph about data quality here.",
      "Another about shadow AI in the business.",
      "A third on what master data costs teams.",
      "A fourth mentioning data quality once more.",
    ].join("\n\n");
    expect(insertInternalLinks(body, CANDIDATES, { max: 2 }).inserted).toHaveLength(2);
    expect(insertInternalLinks(body, CANDIDATES, { max: 0 }).inserted).toHaveLength(0);
  });

  it("uses each target only once", () => {
    const body = "Data quality here.\n\nAnd data quality again over here.";
    const { contentMd, inserted } = insertInternalLinks(body, CANDIDATES);
    expect(inserted).toHaveLength(1);
    expect(contentMd.match(/five-data-quality-signs/g)).toHaveLength(1);
  });

  it("places at most one link per paragraph", () => {
    // Two references in one breath reads as SEO filler, not as a reference.
    const body = "A line on data quality and also shadow AI in one paragraph.";
    expect(insertInternalLinks(body, CANDIDATES).inserted).toHaveLength(1);
  });
});

describe("insertInternalLinks never damages the markdown", () => {
  it("leaves headings alone, because the table of contents scans them", () => {
    const body = "## Data quality matters\n\nSomething unrelated follows here.";
    const { contentMd, inserted } = insertInternalLinks(body, CANDIDATES);
    expect(contentMd).toBe(body);
    expect(inserted).toHaveLength(0);
  });

  it("leaves fenced code alone", () => {
    const body = "```\nSELECT * FROM data quality;\n```\n\nPlain text after it.";
    expect(insertInternalLinks(body, CANDIDATES).contentMd).toBe(body);
  });

  it("leaves inline code alone", () => {
    const body = "Run `check data quality` before you start the migration.";
    expect(insertInternalLinks(body, CANDIDATES).contentMd).toBe(body);
  });

  it("never nests a link inside an existing one", () => {
    const body = "See [our data quality guide](/blog/other) for the detail.";
    expect(insertInternalLinks(body, CANDIDATES).contentMd).toBe(body);
  });

  it("does not silently edit a quotation", () => {
    // Adding a link inside someone's quoted words is still editing them.
    const body = "> Their data quality was the root cause.\n\nPlain text after.";
    expect(insertInternalLinks(body, CANDIDATES).contentMd).toBe(body);
  });

  it("does not link inside a bare URL", () => {
    const body = "See https://example.com/data-quality-signs for more detail.";
    expect(insertInternalLinks(body, CANDIDATES).contentMd).toBe(body);
  });

  it("matches whole words only", () => {
    const body = "The metadata qualityish score is not what we mean here.";
    expect(insertInternalLinks(body, CANDIDATES).inserted).toHaveLength(0);
  });

  it("keeps every offset correct when it inserts several links", () => {
    const body = [
      "First paragraph mentioning data quality plainly.",
      "Second paragraph mentioning shadow AI plainly.",
      "Third paragraph mentioning master data plainly.",
    ].join("\n\n");
    const { contentMd, inserted } = insertInternalLinks(body, CANDIDATES);
    expect(inserted).toHaveLength(3);
    // Applying edits front-to-back would corrupt later offsets; this catches it.
    expect(contentMd).toContain("[data quality](/blog/five-data-quality-signs)");
    expect(contentMd).toContain("[shadow AI](/blog/shadow-ai-inside-your-team)");
    expect(contentMd).toContain("[master data](/blog/what-master-data-costs)");
    expect(contentMd).not.toMatch(/\]\(\/blog\/[^)]*\[/);
  });

  it("only ever adds link syntax — the prose itself is unchanged", () => {
    // The safety property that lets this run after the gate.
    const body = [
      "First paragraph mentioning data quality plainly.",
      "Second paragraph mentioning shadow AI plainly.",
    ].join("\n\n");
    const { contentMd } = insertInternalLinks(body, CANDIDATES);
    const stripped = contentMd.replace(/\[([^\]]+)\]\(\/blog\/[^)]+\)/g, "$1");
    expect(stripped).toBe(body);
  });

  it("only ever emits internal /blog/ URLs", () => {
    const body = "A paragraph about data quality and about shadow AI too.\n\nMore.";
    const { contentMd } = insertInternalLinks(body, CANDIDATES);
    for (const m of contentMd.matchAll(/\]\(([^)]+)\)/g)) {
      expect(m[1]).toMatch(/^\/blog\/[a-z0-9-]+$/);
    }
  });

  it("handles an empty body and empty candidates", () => {
    expect(insertInternalLinks("", CANDIDATES).contentMd).toBe("");
    expect(insertInternalLinks("Some text about data quality.", []).inserted).toEqual([]);
  });
});

describe("matching tolerates how titles and prose actually differ", () => {
  // Measured on a real run: 1 of 6 relevant candidates matched. The misses
  // were all posts about the same subject whose titles used a plural or whose
  // phrase happened to straddle a line break.
  const plural = [{ slug: "why-ai-pilots-die", title: "Why AI Pilots Die Before Production" }];

  it("matches a plural title against singular prose", () => {
    const { inserted } = insertInternalLinks(
      "Every AI pilot we see starts the same way.",
      plural,
    );
    expect(inserted).toEqual([{ slug: "why-ai-pilots-die", anchor: "AI pilot" }]);
  });

  it("matches singular title against plural prose", () => {
    const { inserted } = insertInternalLinks(
      "Most data problems start here.",
      [{ slug: "the-data-problem", title: "The Data Problem Nobody Owns" }],
    );
    expect(inserted[0]?.anchor).toBe("data problems");
  });

  it("matches across a line break, because markdown wraps", () => {
    const { contentMd } = insertInternalLinks("Most teams find their data\nquality is poor.", [
      { slug: "five-signs", title: "Five Data Quality Signs" },
    ]);
    expect(contentMd).toContain("](/blog/five-signs)");
  });

  it("reaches a plural body from a singular title", () => {
    // Only caught by mutation testing: one length floor was doing two jobs and
    // blocked this, which is a match we want.
    const { inserted } = insertInternalLinks("We found the data gaps early on.", [
      { slug: "mind-the-gap", title: "Data Gap Analysis" },
    ]);
    expect(inserted).toEqual([{ slug: "mind-the-gap", anchor: "data gaps" }]);
  });

  // "Data Is Fine" yields exactly one usable phrase, "data is fine" — the
  // two-word runs all start or end on a stopword. So these two probe the short
  // word itself rather than sneaking a match in through another phrase, which
  // is how the first version of this test fooled itself.
  const shortWord = [{ slug: "x", title: "Data Is Fine" }];

  it("never strips the 's' off a short word, which would match a stray letter", () => {
    // "is" must not become "i". Stripping shortens what can match; adding does
    // not, which is why the two halves of the rule have different floors.
    const { inserted } = insertInternalLinks(
      "The data i fine print says otherwise here.",
      shortWord,
    );
    expect(inserted).toHaveLength(0);
  });

  it("still matches that phrase when the short word is really there", () => {
    const { inserted } = insertInternalLinks(
      "The data is fine until someone looks at it.",
      shortWord,
    );
    expect(inserted).toEqual([{ slug: "x", anchor: "data is fine" }]);
  });

  it("still refuses a partial word", () => {
    const { inserted } = insertInternalLinks(
      "The metadata qualityish score is meaningless.",
      [{ slug: "x", title: "Five Data Quality Signs" }],
    );
    expect(inserted).toHaveLength(0);
  });
});
