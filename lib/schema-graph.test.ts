import { describe, expect, it } from "vitest";
import {
  buildGraph,
  founderNode,
  FOUNDER_JOB_TITLE,
  metisNode,
  personIdForAuthor,
  ref,
  SCHEMA_IDS,
} from "./schema-graph";
import { sameAsFor, SOCIAL_LINKS } from "./social-links";

// The whole point of this module is that Google resolves ONE organisation and
// ONE person per real-world entity instead of one per page that mentions them.
// These tests pin the two ways that can silently break: an @id changing (every
// existing reference dangles) and an identity being asserted that the data
// cannot support.

describe("SCHEMA_IDS", () => {
  it("are absolute URLs on the canonical origin", () => {
    // Relative or origin-mismatched @ids do not merge across pages.
    for (const id of Object.values(SCHEMA_IDS)) {
      expect(id.startsWith("https://archoslabs.xyz")).toBe(true);
    }
  });

  it("are all distinct", () => {
    const ids = Object.values(SCHEMA_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the founder and the AI agent as separate entities", () => {
    // Collapsing these would assert that an AI research agent is the founder.
    expect(SCHEMA_IDS.person).not.toBe(SCHEMA_IDS.metis);
  });
});

describe("personIdForAuthor", () => {
  it("resolves the agent regardless of casing or padding", () => {
    for (const name of ["Metis", "metis", "  METIS  "]) {
      expect(personIdForAuthor(name)).toBe(SCHEMA_IDS.metis);
    }
  });

  it("returns undefined for the founder's name", () => {
    // Deliberate. There is one author row and the seed backfill renamed it to
    // "Metis", so post.authorName can never BE the founder. Promoting a post to
    // #rob-angeles is a review-status decision (reviewed_by_human_at), not a
    // name match — asserting it here would be a false authorship claim.
    expect(personIdForAuthor("Rob Angeles")).toBeUndefined();
  });

  it("returns undefined for an unknown author", () => {
    expect(personIdForAuthor("Someone Else")).toBeUndefined();
    expect(personIdForAuthor("")).toBeUndefined();
  });
});

describe("buildGraph", () => {
  it("hoists @context to the root and strips it from every node", () => {
    const graph = buildGraph([
      { "@context": "https://schema.org", "@type": "Person", name: "A" },
      { "@context": "https://schema.org", "@type": "Organization", name: "B" },
    ]);

    expect(graph["@context"]).toBe("https://schema.org");
    const nodes = graph["@graph"] as Array<Record<string, unknown>>;
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node["@context"]).toBeUndefined();
    }
  });

  it("preserves every other field verbatim", () => {
    const graph = buildGraph([
      { "@context": "https://schema.org", "@type": "Person", name: "A", x: 1 },
    ]);
    expect((graph["@graph"] as Array<Record<string, unknown>>)[0]).toEqual({
      "@type": "Person",
      name: "A",
      x: 1,
    });
  });

  it("emits exactly one @context in the serialised payload", () => {
    // The failure this guards: leaving @context on children bloats every page
    // and is what a reviewer would flag as sloppy structured data.
    const json = JSON.stringify(
      buildGraph([
        { "@context": "https://schema.org", "@type": "Person" },
        { "@context": "https://schema.org", "@type": "Organization" },
        { "@context": "https://schema.org", "@type": "WebSite" },
      ]),
    );
    expect(json.split('"@context"').length - 1).toBe(1);
  });

  it("tolerates a node that has no @context", () => {
    const graph = buildGraph([{ "@type": "Person", name: "A" }]);
    expect((graph["@graph"] as unknown[])[0]).toEqual({
      "@type": "Person",
      name: "A",
    });
  });
});

describe("founderNode", () => {
  const node = () =>
    founderNode({ founderName: "Rob Angeles", founderLinkedinUrl: "" });

  it("carries the canonical person @id and the single job title", () => {
    expect(node()["@id"]).toBe(SCHEMA_IDS.person);
    expect(node().jobTitle).toBe(FOUNDER_JOB_TITLE);
  });

  it("points worksFor at the org node rather than inlining it", () => {
    expect(node().worksFor).toEqual({ "@id": SCHEMA_IDS.org });
  });

  it("EXCLUDES the organisation's X handle from the person's sameAs", () => {
    // The regression this exists to prevent: x.com/archoslabsxyz is the BRAND
    // account and is also the site's twitter:site. Listing it as sameAs on the
    // Person asserts Rob Angeles and Archos Labs are the same entity — the
    // exact fragmentation this module removes, reintroduced inside the fix.
    const sameAs = node().sameAs as string[];
    expect(sameAs.some((u) => u.includes("x.com/archoslabsxyz"))).toBe(false);
    expect(sameAs.some((u) => u.includes("linkedin.com/in/robangeles22"))).toBe(
      true,
    );
    expect(sameAs.some((u) => u.includes("github.com/robertangeles"))).toBe(true);
    expect(sameAs.some((u) => u.includes("huggingface.co/robangeles"))).toBe(
      true,
    );
  });

  it("does not duplicate a configured LinkedIn already in the constant list", () => {
    const sameAs = founderNode({
      founderName: "Rob Angeles",
      founderLinkedinUrl: "https://www.linkedin.com/in/robangeles22/",
    }).sameAs as string[];
    expect(new Set(sameAs).size).toBe(sameAs.length);
  });

  it("drops an unconfigured LinkedIn instead of emitting an empty string", () => {
    const sameAs = node().sameAs as string[];
    expect(sameAs).not.toContain("");
  });

  it("declares the CDMP credential against DAMA", () => {
    const cred = node().hasCredential as Record<string, unknown>;
    expect(cred["@type"]).toBe("EducationalOccupationalCredential");
    expect(cred.name).toContain("CDMP");
    expect((cred.recognizedBy as Record<string, unknown>).name).toBe(
      "DAMA International",
    );
  });
});

describe("metisNode", () => {
  it("is a distinct node that describes itself as an AI agent", () => {
    const node = metisNode();
    expect(node["@id"]).toBe(SCHEMA_IDS.metis);
    expect(node.name).toBe("Metis");
    // Honesty check: the node must not read as a human colleague.
    expect(String(node.description)).toMatch(/AI research agent/i);
    expect(node.worksFor).toEqual({ "@id": SCHEMA_IDS.org });
  });
});

describe("social link entity split", () => {
  it("assigns every link to exactly one entity", () => {
    for (const link of SOCIAL_LINKS) {
      expect(["person", "org"]).toContain(link.entity);
    }
    expect(sameAsFor("person").length + sameAsFor("org").length).toBe(
      SOCIAL_LINKS.length,
    );
  });

  it("puts the brand X account on the org, not the person", () => {
    expect(sameAsFor("org")).toContain("https://x.com/archoslabsxyz");
    expect(sameAsFor("person")).not.toContain("https://x.com/archoslabsxyz");
  });
});

describe("ref", () => {
  it("emits a bare @id reference and nothing else", () => {
    expect(ref(SCHEMA_IDS.org)).toEqual({ "@id": SCHEMA_IDS.org });
    expect(Object.keys(ref("x"))).toEqual(["@id"]);
  });
});
