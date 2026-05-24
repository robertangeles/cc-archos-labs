import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Test strategy:
//   - Mock `./embeddings` so embedPostContent returns a known vector
//     without making an OpenRouter call.
//   - Mock `../db` so getDb() returns a fluent stub that yields a
//     canned array of rows. We don't validate the actual SQL composition
//     here — that's covered by integration tests against the real
//     post.embedding column + HNSW index.
//
// What we DO validate at this layer:
//   - Limit clamping (input 0 → 1, input 50 → 20, default 5)
//   - maxDistance filtering (application-layer; pgvector returns ordered
//     rows but we filter beyond threshold ourselves)
//   - Distance coercion (postgres.js can return numeric as string)
//   - searchByEmbedding does NOT call the embedder (caller-provided vec)
//   - findSimilarPosts DOES call the embedder once with queryText

let dbRows: Array<Record<string, unknown>> = [];
const embedderMock = vi.fn(async () => new Array(1024).fill(0.5));

vi.mock("../embeddings", () => ({
  embedPostContent: embedderMock,
}));

vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => dbRows,
            }),
          }),
        }),
      }),
    }),
  }),
}));

const { searchByEmbedding, findSimilarPosts } = await import("./find-similar");

beforeEach(() => {
  dbRows = [];
  embedderMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "post-1",
    slug: "post-one",
    title: "Post One",
    excerpt: "An excerpt",
    readingTimeMin: 5,
    categoryName: "Category A",
    ogImagePath: null,
    ogImageDeletedAt: null,
    ogImageAlt: null,
    ogImageWidth: null,
    ogImageHeight: null,
    distance: 0.2,
    ...overrides,
  };
}

describe("searchByEmbedding", () => {
  it("returns the canned rows when DB yields results", async () => {
    dbRows = [row({ id: "a", distance: 0.1 }), row({ id: "b", distance: 0.3 })];
    const result = await searchByEmbedding(new Array(1024).fill(0.5));
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
  });

  it("does NOT call the embedder (caller supplies the vector)", async () => {
    dbRows = [row()];
    await searchByEmbedding(new Array(1024).fill(0.5));
    expect(embedderMock).not.toHaveBeenCalled();
  });

  it("coerces string distance to number (postgres.js numeric quirk)", async () => {
    dbRows = [row({ distance: "0.42" })];
    const result = await searchByEmbedding(new Array(1024).fill(0.5));
    expect(typeof result[0].distance).toBe("number");
    expect(result[0].distance).toBeCloseTo(0.42);
  });

  it("filters rows beyond maxDistance", async () => {
    dbRows = [
      row({ id: "near", distance: 0.1 }),
      row({ id: "mid", distance: 0.4 }),
      row({ id: "far", distance: 0.9 }),
    ];
    const result = await searchByEmbedding(new Array(1024).fill(0.5), {
      maxDistance: 0.5,
    });
    expect(result.map((r) => r.id)).toEqual(["near", "mid"]);
  });

  it("does NOT filter when maxDistance is undefined", async () => {
    dbRows = [
      row({ id: "near", distance: 0.1 }),
      row({ id: "far", distance: 1.8 }),
    ];
    const result = await searchByEmbedding(new Array(1024).fill(0.5));
    expect(result).toHaveLength(2);
  });

  it("returns empty array when DB yields no rows", async () => {
    dbRows = [];
    const result = await searchByEmbedding(new Array(1024).fill(0.5));
    expect(result).toEqual([]);
  });
});

describe("findSimilarPosts", () => {
  it("calls the embedder exactly once with queryText", async () => {
    dbRows = [row()];
    await findSimilarPosts({
      queryText: { title: "T", excerpt: "E", contentMd: "M" },
    });
    expect(embedderMock).toHaveBeenCalledTimes(1);
    expect(embedderMock).toHaveBeenCalledWith({
      title: "T",
      excerpt: "E",
      contentMd: "M",
    });
  });

  it("projects rows to the narrow SimilarPost shape (no OG image fields)", async () => {
    dbRows = [
      row({
        id: "p1",
        slug: "post-one",
        title: "One",
        excerpt: "ex",
        categoryName: "Cat",
        ogImagePath: "/og/some.png",
        ogImageWidth: 1200,
        readingTimeMin: 7,
        distance: 0.15,
      }),
    ];
    const result = await findSimilarPosts({
      queryText: { title: "q" },
    });
    expect(result).toEqual([
      {
        id: "p1",
        slug: "post-one",
        title: "One",
        excerpt: "ex",
        categoryName: "Cat",
        distance: 0.15,
      },
    ]);
    // OG fields and readingTimeMin are intentionally dropped — callers
    // that need them should use searchByEmbedding directly.
    expect(result[0]).not.toHaveProperty("ogImagePath");
    expect(result[0]).not.toHaveProperty("readingTimeMin");
  });

  it("passes through maxDistance + filters beyond threshold", async () => {
    dbRows = [
      row({ id: "a", distance: 0.1 }),
      row({ id: "b", distance: 0.9 }),
    ];
    const result = await findSimilarPosts({
      queryText: { title: "q" },
      maxDistance: 0.5,
    });
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns empty array when no rows match", async () => {
    dbRows = [];
    const result = await findSimilarPosts({
      queryText: { title: "q" },
    });
    expect(result).toEqual([]);
  });
});
