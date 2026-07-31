import { describe, expect, it } from "vitest";
import { chunkText, ChunkLimitError, MAX_CHUNKS_PER_DOCUMENT } from "./chunking";

// A paragraph big enough to become its own chunk at the default token limit.
const bigPara = () => "word ".repeat(800).trim();

describe("chunkText", () => {
  it("returns a single chunk for text under the token limit", () => {
    expect(chunkText("a short paragraph of text")).toHaveLength(1);
  });

  it("splits long text into multiple chunks", () => {
    const chunks = chunkText([bigPara(), bigPara(), bigPara()].join("\n\n"));
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("returns empty for empty or whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  // THE REGRESSION THIS LOCKS DOWN.
  //
  // chunkText used to end with `return chunks.slice(0, 500)`. A book longer
  // than that lost its tail without a word: chunk_count recorded the truncated
  // total, so the admin page showed a healthy "496 chunks, ready" document.
  // DMBOK landed at 496 — four chunks from the ceiling — so the next long book
  // would have been quietly half-ingested with no signal anywhere.
  //
  // The cap is injectable purely so this can be proved without generating
  // ~1.5M words of input.
  it("THROWS rather than truncating when the cap is exceeded", () => {
    const text = Array.from({ length: 8 }, bigPara).join("\n\n");
    expect(() => chunkText(text, undefined, undefined, 3)).toThrow(ChunkLimitError);
  });

  it("does not throw at exactly the cap", () => {
    const text = Array.from({ length: 8 }, bigPara).join("\n\n");
    const produced = chunkText(text).length;
    expect(() => chunkText(text, undefined, undefined, produced)).not.toThrow();
  });

  it("the error names the limit and says it refuses to truncate", () => {
    const text = Array.from({ length: 8 }, bigPara).join("\n\n");
    try {
      chunkText(text, undefined, undefined, 3);
      throw new Error("expected chunkText to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ChunkLimitError);
      expect((err as Error).message).toMatch(/over the 3 limit/);
      expect((err as Error).message).toMatch(/truncate/i);
    }
  });

  it("the production cap is well clear of the largest real book", () => {
    // DMBOK, the largest document in the library, is 496 chunks. A cap that
    // sits just above the biggest book is a cap that will fire on the next one.
    expect(MAX_CHUNKS_PER_DOCUMENT).toBeGreaterThan(1000);
  });
});
