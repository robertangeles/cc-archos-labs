import { describe, expect, it } from "vitest";
import { rankMemories, type Candidate } from "./memory";

// Pure-logic tests for the in-app pgvector memory backend. The DB + embedding
// paths (recallFromDb/captureToDb) need a real pgvector engine + live
// embeddings, so they are proven by scripts/verify-brain-pgvector.mjs against
// the DEV DB — the same reason the repo's eval suite is excluded from CI.

describe("rankMemories()", () => {
  const NOW = Date.parse("2026-07-16T00:00:00Z");
  const today = new Date(NOW).toISOString();
  const monthAgo = new Date(NOW - 30 * 86_400_000).toISOString();

  it("ranks higher similarity first when recency is equal", () => {
    const rows: Candidate[] = [
      { body: "weak", created_at: today, similarity: 0.4 },
      { body: "strong", created_at: today, similarity: 0.9 },
    ];
    expect(rankMemories(rows, NOW)).toEqual(["strong", "weak"]);
  });

  it("lets recency break a near-tie in similarity", () => {
    // Same similarity; the fresher memory wins on the 0.2·recency term.
    const rows: Candidate[] = [
      { body: "old", created_at: monthAgo, similarity: 0.8 },
      { body: "fresh", created_at: today, similarity: 0.8 },
    ];
    expect(rankMemories(rows, NOW)[0]).toBe("fresh");
  });

  it("does NOT let recency override a large similarity gap", () => {
    // A strongly relevant old memory still beats a weakly relevant fresh one:
    // 0.7·0.9 + 0.2·e^-1 = 0.70 vs 0.7·0.3 + 0.2·1 = 0.41.
    const rows: Candidate[] = [
      { body: "fresh-weak", created_at: today, similarity: 0.3 },
      { body: "old-strong", created_at: monthAgo, similarity: 0.9 },
    ];
    expect(rankMemories(rows, NOW)[0]).toBe("old-strong");
  });

  it("caps the result at topK, newest-strongest first", () => {
    const rows: Candidate[] = Array.from({ length: 10 }, (_, i) => ({
      body: `m${i}`,
      created_at: today,
      similarity: i / 10,
    }));
    const out = rankMemories(rows, NOW, 6);
    expect(out).toHaveLength(6);
    expect(out[0]).toBe("m9"); // highest similarity
  });

  it("returns [] for no candidates", () => {
    expect(rankMemories([], NOW)).toEqual([]);
  });
});
