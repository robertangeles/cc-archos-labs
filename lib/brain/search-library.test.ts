import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../knowledge/search";

// search_library lets the model chase a thread into the practice library
// mid-answer. Two properties matter more than anything else it does:
//
//   1. a CLIENT turn must never receive a document title through it. The
//      pre-turn excerpts are stripped for client audiences; this is a second
//      door into the same prompt and needs the same rule.
//   2. it must not re-serve passages the pre-turn retrieval already injected —
//      the model seeing the same text twice reads it as two sources agreeing.

let libraryImpl: (q: string) => Promise<SearchResult[]>;

vi.mock("../knowledge/search", () => ({
  searchLibraryChunks: (q: string) => libraryImpl(q),
}));
vi.mock("../projects/service", () => ({ listProjects: async () => [] }));
vi.mock("../clients/service", () => ({ listClients: async () => [] }));
vi.mock("../kanban/service", () => ({ getBoard: async () => null }));
vi.mock("./memory", () => ({ recallWorkspaceFromDb: async () => ["a fact"] }));

const { executeWorkspaceTool, toolsFor, WORKSPACE_TOOLS } = await import("./traversal");

let seq = 0;
const chunk = (title: string, content = "some substantive passage"): SearchResult => ({
  chunkId: `chunk-${seq++}`,
  documentId: `doc-${title}`,
  title,
  author: `${title} author`,
  category: null,
  content,
  similarity: 0.6,
});

beforeEach(() => {
  libraryImpl = async () => [chunk("Flawless Consulting"), chunk("DAMA-DMBOK")];
});

describe("search_library — audience", () => {
  it("names the work for an internal turn", async () => {
    const out = await executeWorkspaceTool(
      "search_library",
      { query: "naming the resistance" },
      { orgId: "org-1", audience: "internal" },
    );
    expect(out).toContain("Flawless Consulting");
    expect(JSON.parse(out).excerpts[0]).toHaveProperty("work");
  });

  // THE LEAK THAT MATTERS. Tool results reach the model through a different
  // door from the pre-turn excerpts; the same rule has to hold at both.
  it("NEVER returns a title to a client turn", async () => {
    const out = await executeWorkspaceTool(
      "search_library",
      { query: "naming the resistance" },
      { orgId: "org-1", audience: "client" },
    );
    expect(out).not.toContain("Flawless Consulting");
    expect(out).not.toContain("DAMA-DMBOK");
    const parsed = JSON.parse(out);
    expect(parsed.excerpts.length).toBeGreaterThan(0);
    for (const e of parsed.excerpts) {
      expect(e).not.toHaveProperty("work");
      expect(e).toHaveProperty("excerpt");
    }
  });
});

describe("search_library — dedup against the pre-turn set", () => {
  it("drops chunks already injected this turn", async () => {
    const already = chunk("DAMA-DMBOK");
    libraryImpl = async () => [already, chunk("Flawless Consulting")];
    const out = await executeWorkspaceTool(
      "search_library",
      { query: "stewardship" },
      { orgId: "org-1", audience: "internal", seenChunkIds: new Set([already.chunkId]) },
    );
    const parsed = JSON.parse(out);
    expect(parsed.alreadySeen).toBe(1);
    expect(out).not.toContain("DAMA-DMBOK");
    expect(out).toContain("Flawless Consulting");
  });

  it("says so when everything found was already shown", async () => {
    const a = chunk("DAMA-DMBOK");
    libraryImpl = async () => [a];
    const out = await executeWorkspaceTool(
      "search_library",
      { query: "stewardship" },
      { orgId: "org-1", audience: "internal", seenChunkIds: new Set([a.chunkId]) },
    );
    const parsed = JSON.parse(out);
    expect(parsed.excerpts).toEqual([]);
    // Distinguishable from "the library has nothing" — different facts.
    expect(parsed.note).toMatch(/already provided/i);
  });

  it("distinguishes an empty library result from an all-deduped one", async () => {
    libraryImpl = async () => [];
    const out = await executeWorkspaceTool(
      "search_library",
      { query: "seed round dilution" },
      { orgId: "org-1", audience: "internal" },
    );
    expect(JSON.parse(out).note).toMatch(/nothing on that/i);
  });
});

describe("search_library — result budget", () => {
  // json() truncates at 4000 chars with a blunt .slice(). A book chunk is
  // ~1000 tokens, so two chunks would be cut mid-word every time and the model
  // would read a severed sentence as a finished thought.
  it("drops whole chunks rather than cutting one mid-sentence", async () => {
    const long = "word ".repeat(1200).trim();
    libraryImpl = async () => [
      chunk("Book A", long),
      chunk("Book B", long),
      chunk("Book C", long),
    ];
    const out = await executeWorkspaceTool(
      "search_library",
      { query: "x" },
      { orgId: "org-1", audience: "internal" },
    );
    // Must be parseable — a mid-string slice would not be.
    const parsed = JSON.parse(out);
    expect(parsed.excerpts.length).toBeGreaterThan(0);
    expect(parsed.omittedForLength).toBeGreaterThan(0);
    for (const e of parsed.excerpts) {
      expect(e.excerpt.endsWith("word")).toBe(true); // not cut mid-word
    }
  });

  it("always returns at least one excerpt even if it is over budget alone", async () => {
    libraryImpl = async () => [chunk("Huge", "x".repeat(50_000))];
    const out = await executeWorkspaceTool(
      "search_library",
      { query: "x" },
      { orgId: "org-1", audience: "internal" },
    );
    const parsed = JSON.parse(out);
    expect(parsed.excerpts.length).toBe(1);
    // No space anywhere in the content: lastIndexOf(" ", ...) returns -1, and
    // slice(0, -1) means "drop the last char" — near-unbounded, not truncated.
    // Assert the actual bound, not just that an excerpt exists.
    expect(parsed.excerpts[0].excerpt.length).toBeLessThan(10_000);
  });
});

describe("per-tool org gating", () => {
  it("offers search_library with no org, and nothing else", () => {
    const names = toolsFor(null).map((t) => t.function.name);
    expect(names).toEqual(["search_library"]);
  });

  it("offers the org-scoped tools once an org resolves", () => {
    const names = toolsFor("org-1").map((t) => t.function.name);
    expect(names).toContain("search_library");
    expect(names).toContain("list_projects");
    expect(names.length).toBe(WORKSPACE_TOOLS.length);
  });

  // The library is a shared shelf with no tenant data. Gating it on org
  // membership is what silently disabled the whole feature for org-less users.
  it("search_library works with a null org", async () => {
    const out = await executeWorkspaceTool(
      "search_library",
      { query: "trust" },
      { orgId: null, audience: "internal" },
    );
    expect(JSON.parse(out).excerpts.length).toBeGreaterThan(0);
  });

  it.each(["search_workspace", "list_projects", "list_clients", "get_project_cards"])(
    "%s refuses a null org instead of querying with one",
    async (tool) => {
      const out = await executeWorkspaceTool(
        tool,
        { query: "x", project_id: "11111111-1111-1111-1111-111111111111" },
        { orgId: null, audience: "internal" },
      );
      expect(JSON.parse(out).error).toMatch(/no workspace/i);
    },
  );
});

describe("search_library — dedup across hops", () => {
  // The tool loop's own guard only catches literally identical calls
  // (name:arguments). Two DIFFERENT queries can return overlapping chunks, and
  // serving the same passage twice is the "two sources agreeing" misread this
  // dedup exists to prevent — so the set has to grow as results are served.
  it("does not re-serve a chunk an earlier call in the same loop returned", async () => {
    const shared = chunk("DAMA-DMBOK");
    const ctx = {
      orgId: "org-1",
      audience: "internal" as const,
      seenChunkIds: new Set<string>(),
    };

    libraryImpl = async () => [shared, chunk("Flawless Consulting")];
    const first = JSON.parse(
      await executeWorkspaceTool("search_library", { query: "stewardship" }, ctx),
    );
    expect(first.excerpts.length).toBe(2);

    // A different query that happens to surface the same chunk again.
    libraryImpl = async () => [shared, chunk("The Trusted Advisor")];
    const second = JSON.parse(
      await executeWorkspaceTool("search_library", { query: "accountability" }, ctx),
    );
    expect(second.alreadySeen).toBe(1);
    expect(JSON.stringify(second)).not.toContain("DAMA-DMBOK");
    expect(JSON.stringify(second)).toContain("The Trusted Advisor");
  });

  it("only records chunks it actually served, not ones dropped for length", async () => {
    const ctx = {
      orgId: "org-1",
      audience: "internal" as const,
      seenChunkIds: new Set<string>(),
    };
    const long = "word ".repeat(1200).trim();
    const a = chunk("Book A", long);
    const b = chunk("Book B", long);
    const c = chunk("Book C", long);
    libraryImpl = async () => [a, b, c];
    const out = JSON.parse(
      await executeWorkspaceTool("search_library", { query: "x" }, ctx),
    );
    expect(out.omittedForLength).toBeGreaterThan(0);
    // A chunk that never reached the model must stay available to a later call.
    expect(ctx.seenChunkIds.size).toBe(out.excerpts.length);
  });
});
