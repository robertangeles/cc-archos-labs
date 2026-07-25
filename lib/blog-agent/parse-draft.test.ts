import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/real-drafts.json";
import { capMeta, normaliseSlug, parseDraft, toTitleCase } from "./parse-draft";

// Every fixture is a real `article_draft` pulled from workflow_execution_run
// in the DEV database. If the essay skill's output shape ever drifts, these
// fail — which is the point. The parser returning null is a loud failure the
// orchestrator turns into a draft; a parser that silently half-succeeds is not.

describe("parseDraft against the 7 real historical drafts", () => {
  it("has fixtures to test against", () => {
    expect(fixtures.length).toBe(7);
  });

  for (const fx of fixtures) {
    describe(fx.id, () => {
      const parsed = parseDraft(fx.articleDraft);

      it("parses", () => {
        expect(parsed).not.toBeNull();
      });

      it("extracts a title with no leading hash", () => {
        expect(parsed!.title.length).toBeGreaterThan(0);
        expect(parsed!.title.startsWith("#")).toBe(false);
      });

      it("strips the H1 from the body so the page does not double-title", () => {
        expect(parsed!.contentMd.startsWith("# ")).toBe(false);
        expect(parsed!.contentMd).not.toContain(`# ${parsed!.title}`);
      });

      it("extracts the standfirst as the excerpt, unwrapped", () => {
        expect(parsed!.excerpt.length).toBeGreaterThan(0);
        expect(parsed!.excerpt.startsWith("*")).toBe(false);
        expect(parsed!.excerpt.endsWith("*")).toBe(false);
        // post.excerpt caps at 500 chars in PostCreateSchema.
        expect(parsed!.excerpt.length).toBeLessThanOrEqual(500);
      });

      it("removes the entire SEO block from the body", () => {
        expect(parsed!.contentMd).not.toContain("**URL slug");
        expect(parsed!.contentMd).not.toContain("**SEO title");
        expect(parsed!.contentMd).not.toContain("**Meta description");
        expect(parsed!.contentMd).not.toContain("**Tags:");
        expect(parsed!.contentMd).not.toContain("**LSI keywords");
        expect(parsed!.contentMd).not.toContain("**SEO Package**");
      });

      it("yields a slug that PostSlugSchema would accept", () => {
        expect(parsed!.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
        expect(parsed!.slug.length).toBeLessThanOrEqual(200);
      });

      it("yields SEO fields within the column limits", () => {
        expect(parsed!.seoTitle.length).toBeGreaterThan(0);
        expect(parsed!.seoDescription.length).toBeGreaterThan(0);
        // seo_description caps at 300 in PostCreateSchema.
        expect(parsed!.seoDescription.length).toBeLessThanOrEqual(300);
      });

      it("yields 1-8 tags", () => {
        expect(parsed!.tags.length).toBeGreaterThan(0);
        expect(parsed!.tags.length).toBeLessThanOrEqual(8);
        expect(parsed!.tags.every((t) => t.length > 0)).toBe(true);
      });

      it("keeps a body substantial enough to be a post", () => {
        expect(parsed!.contentMd.split(/\s+/).length).toBeGreaterThan(300);
      });
    });
  }
});

describe("parseDraft rejects malformed input rather than half-parsing", () => {
  const good = fixtures[0].articleDraft;

  it("returns null on empty input", () => {
    expect(parseDraft("")).toBeNull();
    expect(parseDraft("   \n  ")).toBeNull();
  });

  it("returns null when the H1 is missing", () => {
    expect(parseDraft(good.replace(/^#\s+/, ""))).toBeNull();
  });

  it("returns null when the H1 is not the first line", () => {
    expect(parseDraft(`Some preamble.\n\n${good}`)).toBeNull();
  });

  it("returns null when the standfirst is missing", () => {
    const noStandfirst = good.replace(/\n\*[^\n]+\*\n/, "\n\n");
    expect(parseDraft(noStandfirst)).toBeNull();
  });

  it("returns null when the SEO block is absent entirely", () => {
    const bodyOnly = good.slice(0, good.indexOf("**LSI keywords"));
    expect(parseDraft(bodyOnly)).toBeNull();
  });

  it("returns null when a single required SEO field is missing", () => {
    for (const label of ["URL slug", "SEO title", "Meta description", "Tags"]) {
      // `\n?` because **Tags:** is the final line of the draft and has no
      // trailing newline to consume.
      const pattern = new RegExp(`\\*\\*${label}:?\\*\\*[^\\n]*\\n?`);
      expect(good, `fixture should contain ${label}`).toMatch(pattern);
      const stripped = good.replace(pattern, "");
      expect(parseDraft(stripped), `missing ${label}`).toBeNull();
    }
  });

  it("returns null when a required SEO field is present but empty", () => {
    const emptied = fixtures[0].articleDraft.replace(
      /\*\*URL slug:\*\*[^\n]*/,
      "**URL slug:**",
    );
    expect(parseDraft(emptied)).toBeNull();
  });
});

describe("parseDraft survives the unstable SEO Package header", () => {
  // Verified empirically: the header appears in only 3 of 7 real drafts.
  // A parser anchored on it would swallow the SEO block into the body on
  // the other 4. This asserts we are anchored on the field labels instead.
  it("parses identically with and without the section header", () => {
    const withHeader = fixtures.find((f) =>
      f.articleDraft.includes("**SEO Package**"),
    );
    expect(withHeader, "expected at least one fixture with the header").toBeDefined();

    const stripped = withHeader!.articleDraft.replace(/\*\*SEO Package\*\*\n*/, "");
    const a = parseDraft(withHeader!.articleDraft);
    const b = parseDraft(stripped);

    expect(b).not.toBeNull();
    expect(b!.slug).toBe(a!.slug);
    expect(b!.contentMd).toBe(a!.contentMd);
  });

  it("counts fixtures without the header, documenting why this matters", () => {
    const without = fixtures.filter(
      (f) => !f.articleDraft.includes("**SEO Package**"),
    );
    expect(without.length).toBeGreaterThan(0);
    for (const fx of without) {
      expect(parseDraft(fx.articleDraft), fx.id).not.toBeNull();
    }
  });
});

describe("normaliseSlug", () => {
  it("passes through an already-clean slug", () => {
    expect(normaliseSlug("shadow-ai-small-team-governance")).toBe(
      "shadow-ai-small-team-governance",
    );
  });

  it("lowercases, strips punctuation, and collapses separators", () => {
    expect(normaliseSlug("Shadow AI: A Founder's Guide!")).toBe(
      "shadow-ai-a-founder-s-guide",
    );
  });

  it("trims leading and trailing hyphens", () => {
    expect(normaliseSlug("  --hello world--  ")).toBe("hello-world");
  });

  it("caps at the 200-char column limit", () => {
    expect(normaliseSlug("a".repeat(300)).length).toBe(200);
  });
});

describe("toTitleCase", () => {
  it("title-cases the real historical headlines", () => {
    expect(toTitleCase("Shadow AI is already inside your team")).toBe(
      "Shadow AI Is Already Inside Your Team",
    );
    expect(toTitleCase("Five signs your data is breaking your AI")).toBe(
      "Five Signs Your Data Is Breaking Your AI",
    );
    expect(toTitleCase("Five data quality signs executives can spot without IT")).toBe(
      "Five Data Quality Signs Executives Can Spot Without IT",
    );
  });

  it("leaves acronyms alone", () => {
    // The dangerous failure: "IT" -> "It" is a real word, so it reads fine and
    // the damage is invisible in a spot check.
    expect(toTitleCase("what IT owes the CDO about ROI")).toBe(
      "What IT Owes the CDO About ROI",
    );
    expect(toTitleCase("AI and the SMB")).toBe("AI and the SMB");
  });

  it("lower-cases minor words except first and last", () => {
    expect(toTitleCase("the cost of a data problem")).toBe(
      "The Cost of a Data Problem",
    );
    // "of" is minor but last, so it stays capitalised.
    expect(toTitleCase("what your data is made of")).toBe(
      "What Your Data Is Made Of",
    );
  });

  it("capitalises verbs, including short ones", () => {
    expect(toTitleCase("your data is wrong")).toBe("Your Data Is Wrong");
  });

  it("capitalises both halves of a hyphenated compound", () => {
    expect(toTitleCase("a non-technical guide")).toBe("A Non-Technical Guide");
  });

  it("preserves possessives and is idempotent", () => {
    const once = toTitleCase("a founder's guide to data");
    expect(once).toBe("A Founder's Guide to Data");
    expect(toTitleCase(once)).toBe(once);
  });
});

describe("capMeta", () => {
  it("leaves anything within the limit untouched", () => {
    const s = "Short and sweet.";
    expect(capMeta(s)).toBe(s);
  });

  it("caps at 160 on a word boundary, never mid-word", () => {
    const long =
      "Data quality is a business problem, not just a technical one. Here are five observable signals that your core records are costing you money every single week without anyone noticing.";
    const out = capMeta(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(long.startsWith(out)).toBe(true);
    expect(out.endsWith(" ")).toBe(false);
  });

  it("trims a trailing comma or dash left by the cut", () => {
    expect(capMeta(`${"x".repeat(150)} word, more`, 160)).not.toMatch(/[,\-–—]$/);
  });

  it("collapses whitespace", () => {
    expect(capMeta("two   spaces\nand a newline")).toBe("two spaces and a newline");
  });

  it("caps the two real drafts that overran 160", () => {
    // Measured: 2 of 7 historical meta descriptions came in at 161 and 163.
    for (const fx of fixtures) {
      const parsed = parseDraft(fx.articleDraft)!;
      expect(parsed.seoDescription.length, fx.id).toBeLessThanOrEqual(160);
      expect(parsed.excerpt.length, fx.id).toBeLessThanOrEqual(160);
    }
  });
});
