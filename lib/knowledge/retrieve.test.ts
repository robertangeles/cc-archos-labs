import { describe, expect, it } from "vitest";
import {
  CANONICAL_DOMAINS,
  COVERAGE_GATE,
  DEFAULT_FLOOR,
  mergeDiverse,
} from "./retrieve";
import type { SearchResult } from "./search";

// mergeDiverse is the entire ranking policy and it is pure, so it is tested
// directly rather than through a mocked embedding API.

let seq = 0;
const chunk = (doc: string, similarity: number, title = doc): SearchResult => ({
  chunkId: `c${seq++}`,
  documentId: doc,
  title,
  category: null,
  content: "x",
  similarity,
});

describe("mergeDiverse — floor", () => {
  it("drops chunks at or below the floor and counts them", () => {
    const r = mergeDiverse([
      chunk("a", 0.60),
      chunk("b", 0.43),
      chunk("c", 0.41),
      chunk("d", 0.20),
    ]);
    expect(r.chunks.map((c) => c.documentId)).toEqual(["a", "b"]);
    expect(r.droppedBelowFloor).toBe(2);
  });

  it("returns nothing when everything is below the floor", () => {
    const r = mergeDiverse([chunk("a", 0.3), chunk("b", 0.1)]);
    expect(r.chunks).toEqual([]);
    expect(r.droppedBelowFloor).toBe(2);
  });

  // The old floor of 0.3 never fired — every sampled chunk cleared it — which
  // made the "library has nothing on this" branch unreachable.
  it("uses a floor that can actually reject real-world scores", () => {
    expect(DEFAULT_FLOOR).toBeGreaterThan(0.3);
    const unanswerableTop1 = 0.466; // measured peak for a question with no shelf
    expect(unanswerableTop1).toBeGreaterThan(DEFAULT_FLOOR - 0.05);
  });
});

describe("mergeDiverse — dedupe", () => {
  it("counts a chunk returned by two sub-queries only once", () => {
    const dup: SearchResult = chunk("a", 0.7);
    const r = mergeDiverse([dup, { ...dup }, chunk("b", 0.6)]);
    expect(r.chunks).toHaveLength(2);
  });

  it("keeps the higher score when the same chunk arrives twice", () => {
    const base = chunk("a", 0.5);
    const r = mergeDiverse([base, { ...base, similarity: 0.8 }]);
    expect(r.chunks[0].similarity).toBe(0.8);
  });
});

describe("mergeDiverse — per-document cap", () => {
  // The measured lift: 1.72 -> 3.83 distinct books came from this step alone.
  it("never exceeds maxPerDoc chunks from one document", () => {
    const pool = Array.from({ length: 8 }, (_, i) => chunk("hog", 0.9 - i * 0.01));
    const r = mergeDiverse([...pool, chunk("b", 0.5), chunk("c", 0.49)]);
    const fromHog = r.chunks.filter((c) => c.documentId === "hog").length;
    expect(fromHog).toBe(2);
  });

  it("without the cap one document would take every slot", () => {
    const pool = Array.from({ length: 8 }, (_, i) => chunk("hog", 0.9 - i * 0.01));
    const uncapped = mergeDiverse(pool, { maxPerDoc: 99 });
    expect(uncapped.chunks).toHaveLength(8);
    expect(new Set(uncapped.chunks.map((c) => c.documentId)).size).toBe(1);
  });

  it("respects finalK", () => {
    const pool = Array.from({ length: 20 }, (_, i) => chunk(`d${i}`, 0.9 - i * 0.01));
    expect(mergeDiverse(pool).chunks.length).toBeLessThanOrEqual(8);
    expect(mergeDiverse(pool, { finalK: 3 }).chunks).toHaveLength(3);
  });

  it("returns results ordered by relevance", () => {
    const pool = [chunk("a", 0.5), chunk("b", 0.9), chunk("c", 0.7)];
    const scores = mergeDiverse(pool).chunks.map((c) => c.similarity);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
  });
});

// The "diversity swap" (step 6) was specified, built and unit-tested here, then
// measured against the real corpus and DELETED. It fired on 0 of 8 questions
// and added +0.00 books, because steps 1-5 already reach 3.9 distinct sources.
// Its tests are gone with it — see the block comment in retrieve.ts and
// tests/eval/retrieval-diversity.eval.test.ts for the measurement that killed
// it. Keeping dead tests for deleted behaviour is how a suite starts lying.

describe("mergeDiverse — degenerate input", () => {
  it("handles an empty pool", () => {
    expect(mergeDiverse([])).toEqual({ chunks: [], droppedBelowFloor: 0 });
  });

  it("handles a single chunk", () => {
    expect(mergeDiverse([chunk("a", 0.9)]).chunks).toHaveLength(1);
  });

  it("never returns more than finalK however pathological the input", () => {
    const pool = Array.from({ length: 500 }, (_, i) => chunk(`d${i % 7}`, 0.99));
    expect(mergeDiverse(pool).chunks.length).toBeLessThanOrEqual(8);
  });
});

describe("constants", () => {
  it("the coverage gate sits between the measured answerable and unanswerable bands", () => {
    // Answerable questions cleared the floor with >=15 chunks; unanswerable
    // peaked at 8. The gate must sit strictly between, with margin either side.
    expect(COVERAGE_GATE).toBeGreaterThan(8);
    expect(COVERAGE_GATE).toBeLessThan(15);
  });

  it("the canonical domains match the corpus taxonomy", () => {
    expect([...CANONICAL_DOMAINS]).toEqual([
      "dmbok",
      "consulting",
      "engineering",
      "analytics",
      "startup",
    ]);
  });
});
