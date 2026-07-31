import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "./search";

// Orchestration tests for retrieve() itself — the pool selection, path
// accounting and degraded logic.
//
// These exist because that code was broken twice in one sitting: once by
// populating a shared `paths` array from concurrent callbacks and then indexing
// results by it (completion order is not Promise.all order), and once by mixing
// cosine and keyword point scores in one sortable pool. Both were caught by
// review and by hand, and NEITHER would have been caught by a test — the pure
// helpers were fully covered and the only end-to-end exercise is DB- and
// API-key-gated, so it is skipped in CI.
//
// Searches are mocked so this runs everywhere, every time.

let vectorImpl: (q: string) => Promise<SearchResult[]>;
let keywordImpl: (q: string) => Promise<SearchResult[]>;

vi.mock("./search", () => ({
  vectorSearch: (q: string) => vectorImpl(q),
  keywordSearch: (q: string) => keywordImpl(q),
}));

const { retrieve } = await import("./retrieve");

let seq = 0;
const chunk = (doc: string, similarity: number): SearchResult => ({
  chunkId: `c${seq++}`,
  documentId: doc,
  title: doc,
  author: null,
  category: null,
  content: "x",
  similarity,
});

// Cosine-scale results (vector) and points-scale results (keyword).
const cosine = (doc: string) => [chunk(doc, 0.62), chunk(doc, 0.55)];
const points = (doc: string) => [chunk(doc, 31), chunk(doc, 24)];

const base = {
  turn: "how do I sequence data governance for a bank that has failed two audits",
  history: [],
  apiKey: "test-key",
  audience: "internal" as const,
};

// The decompose call is a real fetch. Stub it so sub-query COUNT is
// deterministic — without this the fake key makes the call fail, retrieve()
// falls back to a single raw query, and every multi-sub-query scenario below
// silently becomes a single-query one that passes for the wrong reason.
function stubDecompose(queries: string[]) {
  vi.stubGlobal("fetch", async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ queries }) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

beforeEach(() => {
  delete process.env.RETRIEVE_FANOUT_ENABLED; // one sub-query, no model call
  vectorImpl = async () => cosine("dmbok");
  keywordImpl = async () => points("kimball");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("retrieve() — healthy path", () => {
  it("uses vector results and reports healthy", async () => {
    const r = await retrieve(base);
    expect(r.degraded).toBe(false);
    expect(r.chunks.length).toBeGreaterThan(0);
    // Cosine scale, so nothing from the keyword mock leaked in.
    expect(r.chunks.every((c) => c.similarity <= 1)).toBe(true);
  });
});

describe("retrieve() — score scales never mix", () => {
  it("discards keyword results when any vector search succeeded", async () => {
    // Fan-out on: 2 sub-queries, one vector, one falling back to keyword.
    process.env.RETRIEVE_FANOUT_ENABLED = "true";
    stubDecompose(["governance operating model", "audit remediation"]);
    let call = 0;
    vectorImpl = async () => {
      call++;
      if (call === 1) return cosine("dmbok");
      throw new Error("embed API down for this sub-query");
    };
    keywordImpl = async () => points("kimball");

    const r = await retrieve(base);
    // THE REGRESSION: keyword scores are 24-31 and cosine 0.55-0.62, so a mixed
    // pool sorted by similarity puts every keyword chunk on top regardless of
    // relevance.
    expect(r.chunks.every((c) => c.similarity <= 1)).toBe(true);
    expect(r.chunks.some((c) => c.documentId === "kimball")).toBe(false);
    // And the drop has to be visible.
    expect(r.degraded).toBe(true);
  });

  it("uses keyword results only when every vector search failed", async () => {
    vectorImpl = async () => { throw new Error("embed API down"); };
    keywordImpl = async () => points("kimball");

    const r = await retrieve(base);
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.chunks.every((c) => c.documentId === "kimball")).toBe(true);
    expect(r.degraded).toBe(true); // serving, but not semantically
  });
});

describe("retrieve() — degraded accounting", () => {
  it("degrades when a sub-query fails both vector and keyword", async () => {
    process.env.RETRIEVE_FANOUT_ENABLED = "true";
    stubDecompose(["governance operating model", "audit remediation"]);
    let call = 0;
    vectorImpl = async () => {
      call++;
      if (call === 1) return cosine("dmbok");
      throw new Error("down");
    };
    keywordImpl = async () => { throw new Error("also down"); };

    const r = await retrieve(base);
    // Results came back from the healthy sub-query, so this is not "no
    // coverage" — but part of the fan-out never ran and the caller must know.
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.degraded).toBe(true);
  });

  it("returns empty and degraded when everything fails", async () => {
    vectorImpl = async () => { throw new Error("down"); };
    keywordImpl = async () => { throw new Error("also down"); };

    const r = await retrieve(base);
    expect(r.chunks).toEqual([]);
    expect(r.degraded).toBe(true);
    expect(r.covered).toBe(false);
  });

  it("never throws, whatever the searches do", async () => {
    vectorImpl = async () => { throw new Error("boom"); };
    keywordImpl = async () => { throw new Error("boom"); };
    await expect(retrieve(base)).resolves.toBeDefined();
  });
});

describe("retrieve() — coverage", () => {
  it("reports uncovered, not degraded, when the search simply finds nothing", async () => {
    vectorImpl = async () => [];
    keywordImpl = async () => [];
    const r = await retrieve(base);
    expect(r.chunks).toEqual([]);
    expect(r.covered).toBe(false);
    // Looked and found nothing — a completely different state from "could not
    // look", and the one stream.ts uses to pick its wording.
    expect(r.degraded).toBe(false);
  });

  it("reports covered when enough chunks clear the floor", async () => {
    vectorImpl = async () =>
      Array.from({ length: 20 }, (_, i) => chunk(`d${i % 5}`, 0.6));
    const r = await retrieve(base);
    expect(r.aboveFloor).toBeGreaterThanOrEqual(12);
    expect(r.covered).toBe(true);
  });

  it("reuses the previous set for a short acknowledgement", async () => {
    const previous = cosine("dmbok");
    let called = false;
    vectorImpl = async () => { called = true; return cosine("other"); };
    const r = await retrieve({ ...base, turn: "ok", previous });
    expect(called).toBe(false); // no search, no model call
    expect(r.chunks).toEqual(previous);
  });
});
