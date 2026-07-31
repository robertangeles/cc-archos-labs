import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CDMP certification questions must be generated ONLY from documents explicitly
// approved as exam sources. Until migration 0039 they were selected with
// `searchKnowledge(label, "dmbok", n)` — a TOPIC label used as an approval flag
// — and 15 of PROD's 19 documents carried that label while being wrong for a
// certification exam. The Trusted Advisor, Flawless Consulting, Clean
// Architecture and The Pragmatic Programmer were all feeding a data-management
// certification practice exam.
//
// Nothing failed. No error, no log, no user-visible symptom — just quietly
// wrong questions. So the guard has to be structural, and it is asserted here
// at the source level because the failure mode is someone "simplifying" the
// filter back to a category string, which reads entirely reasonable in a diff.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("CDMP corpus scoping", () => {
  it("selects exam material by is_cdmp_source, never by category", () => {
    const search = read("../knowledge/search.ts");
    // Isolate the CDMP section — vectorSearch/keywordSearch above it are
    // general-purpose and legitimately take a category filter.
    const cdmpSection = search.slice(search.indexOf("── CDMP certification pool"));
    expect(cdmpSection.length).toBeGreaterThan(200);

    // Every query in that section must be scoped by the approval flag.
    const queries = cdmpSection.match(/FROM knowledge_chunk c[\s\S]*?(?:LIMIT|`)/g) ?? [];
    expect(queries.length).toBeGreaterThanOrEqual(3);
    for (const q of queries) {
      expect(q, `CDMP query not scoped by is_cdmp_source:\n${q}`).toMatch(
        /d\.is_cdmp_source\s*=\s*true/,
      );
    }

    // And none of them may reintroduce the topic-label filter.
    expect(
      cdmpSection,
      "CDMP scoping must not filter on category — that is the exact defect migration 0039 removed",
    ).not.toMatch(/d\.category\s*=\s*'dmbok'/);
  });

  it("the exam generator calls the CDMP-scoped search, not the general one", () => {
    const generate = read("./generate.ts");
    expect(generate).toMatch(/searchCdmpSources\(/);
    // The general searchKnowledge takes a category argument and would silently
    // widen the pool again.
    expect(
      generate,
      "generate.ts must not call searchKnowledge — it selects by category",
    ).not.toMatch(/\bsearchKnowledge\s*\(/);
  });

  it("the retag mapping approves exactly the two DAMA-syllabus works", () => {
    const retag = read("../../scripts/retag-knowledge-corpus.mjs");
    const approved = [...retag.matchAll(/title:\s*"([^"]+)"[^}]*?isCdmp:\s*true/g)].map(
      (m) => m[1],
    );
    expect(approved).toHaveLength(2);
    expect(approved[0]).toMatch(/DAMA-DMBOK/);
    expect(approved[1]).toMatch(/Data Warehouse Toolkit/);

    // The Unified Star Schema is the case that proves domain and exam
    // eligibility are different axes: data-management by topic, but built on a
    // proprietary technique that is not DAMA syllabus. If a future edit flips
    // it to isCdmp: true, that reasoning has been lost.
    expect(retag).toMatch(/The Unified Star Schema[\s\S]{0,400}?isCdmp:\s*false/);
  });
});
