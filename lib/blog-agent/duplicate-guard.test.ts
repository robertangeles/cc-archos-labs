import { afterEach, describe, expect, it, vi } from "vitest";

// The guard exists because three near-identical posts reached DEV. All three
// were `scheduled`, and searchByEmbedding hard-filters status='published' — so
// the obvious helper was structurally blind to exactly the thing that repeats.

const embedMock = vi.fn();
const whereSpy = vi.fn();
let rows: Array<{ id: string; slug: string; title: string; status: string; distance: unknown }> = [];

vi.mock("../embeddings", () => ({
  embedPostContent: (...a: unknown[]) => embedMock(...a),
  EmbeddingError: class extends Error {},
}));

vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          whereSpy(w);
          return { orderBy: () => ({ limit: async () => rows }) };
        },
      }),
    }),
  }),
}));

const { findDuplicateTopic, OCCUPIED } = await import("./duplicate-guard");

afterEach(() => {
  rows = [];
  vi.clearAllMocks();
  embedMock.mockResolvedValue([0.1, 0.2, 0.3]);
});

const near = { id: "p1", slug: "a", title: "Why AI Pilots Die", status: "scheduled", distance: 0.12 };
const far = { id: "p2", slug: "b", title: "Something Else", status: "published", distance: 0.9 };

describe("findDuplicateTopic", () => {
  it("flags a topic closer than the threshold", async () => {
    embedMock.mockResolvedValue([0.1]);
    rows = [near];
    const hit = await findDuplicateTopic("Why AI Pilots Fail", 0.25);
    expect(hit).toMatchObject({ slug: "a", status: "scheduled" });
    expect(hit!.distance).toBeCloseTo(0.12);
  });

  it("searches scheduled posts, not only published ones", () => {
    // This pins the constant rather than the query, because the DB here is a
    // mock that ignores its own WHERE clause — a filter test through it would
    // pass no matter what the filter said, which is worse than no test.
    //
    // The real filter was verified against the DEV database: with these two
    // statuses the nearest neighbour of a scheduled post is that post
    // (distance 0.0000); with 'published' alone it is invisible. That gap is
    // the bug this module exists for.
    expect([...OCCUPIED]).toEqual(["published", "scheduled"]);
  });

  it("still reports a scheduled row as the match", async () => {
    embedMock.mockResolvedValue([0.1]);
    rows = [near];
    expect((await findDuplicateTopic("x", 0.25))?.status).toBe("scheduled");
  });

  it("allows a topic at or beyond the threshold", async () => {
    embedMock.mockResolvedValue([0.1]);
    rows = [far];
    expect(await findDuplicateTopic("x", 0.25)).toBeNull();
    rows = [{ ...near, distance: 0.25 }];
    expect(await findDuplicateTopic("x", 0.25)).toBeNull();
  });

  it("coerces a distance returned as a string", async () => {
    // postgres.js hands numeric back as a string in some configurations, and
    // "0.12" >= 0.25 is false but "0.9" >= 0.25 is also false — string
    // comparison would let a distant post through as a duplicate.
    embedMock.mockResolvedValue([0.1]);
    rows = [{ ...far, distance: "0.9" }];
    expect(await findDuplicateTopic("x", 0.25)).toBeNull();
    rows = [{ ...near, distance: "0.12" }];
    expect(await findDuplicateTopic("x", 0.25)).not.toBeNull();
  });
});

describe("findDuplicateTopic fails open", () => {
  it("returns null when the embedder throws", async () => {
    // Failing closed would stop the agent writing anything the moment the
    // embedding API had a bad minute. A repeated topic is the smaller cost.
    embedMock.mockRejectedValue(new Error("502"));
    expect(await findDuplicateTopic("x", 0.25)).toBeNull();
  });

  it("returns null when there is nothing to compare against", async () => {
    embedMock.mockResolvedValue([0.1]);
    rows = [];
    expect(await findDuplicateTopic("x", 0.25)).toBeNull();
  });

  it("returns null on a blank title without calling the embedder", async () => {
    expect(await findDuplicateTopic("   ", 0.25)).toBeNull();
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns null when the distance is not a number", async () => {
    embedMock.mockResolvedValue([0.1]);
    rows = [{ ...near, distance: null }];
    expect(await findDuplicateTopic("x", 0.25)).toBeNull();
  });

  it("embeds the title only, not a whole draft", async () => {
    // It runs before the workflow, so a title is all that exists — and that
    // is the point: a duplicate costs an embedding, not a research call.
    embedMock.mockResolvedValue([0.1]);
    rows = [];
    await findDuplicateTopic("Four Checks That Predict Failure", 0.25);
    expect(embedMock).toHaveBeenCalledWith({
      title: "Four Checks That Predict Failure",
    });
  });
});
