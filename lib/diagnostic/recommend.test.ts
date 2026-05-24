import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionItem } from "./report-types";

// Mock the shared retrieval helper so tests are deterministic and don't
// touch the DB or the embedding API. The orchestration logic is the
// thing under test here — retrieval correctness is covered by
// lib/posts/find-similar.test.ts and the eval suite.

interface MockedFindSimilarPostsCall {
  queryText: { title: string; excerpt?: string | null; contentMd?: string | null };
  limit?: number;
  maxDistance?: number;
  visibility?: "public" | "any";
  excludePostIds?: string[];
}

const findSimilarPostsMock = vi.fn();

vi.mock("../posts/find-similar", () => ({
  findSimilarPosts: findSimilarPostsMock,
}));

const { recommendForReport, buildActionQueryText, SIMILARITY_THRESHOLD } =
  await import("./recommend");

function action(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    title: "Document data lineage end-to-end",
    explanation:
      "Foundational issue: undocumented lineage is causing trust issues.",
    time_horizon: "immediate",
    service_line: "ai_readiness_assessment",
    ...overrides,
  };
}

function post(overrides: Partial<{ id: string; slug: string; title: string; distance: number }> = {}) {
  return {
    id: "post-default",
    slug: "default",
    title: "Default Post",
    excerpt: null,
    categoryName: null,
    distance: 0.3,
    ...overrides,
  };
}

beforeEach(() => {
  findSimilarPostsMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildActionQueryText", () => {
  it("composes title, explanation, and service line", () => {
    const result = buildActionQueryText(action());
    expect(result.title).toBe("Document data lineage end-to-end");
    expect(result.excerpt).toContain("undocumented lineage");
    expect(result.contentMd).toContain("AI Readiness Assessment");
  });

  it("maps each ActionServiceLine to its human label", () => {
    expect(
      buildActionQueryText(action({ service_line: "data_architecture" })).contentMd,
    ).toContain("Data Architecture");
    expect(
      buildActionQueryText(action({ service_line: "ai_agent_development" }))
        .contentMd,
    ).toContain("AI Agent Development");
  });
});

describe("recommendForReport — per-action happy path", () => {
  it("returns one rec per action when each action returns a unique post", async () => {
    findSimilarPostsMock
      .mockResolvedValueOnce([post({ id: "p1" })])
      .mockResolvedValueOnce([post({ id: "p2" })])
      .mockResolvedValueOnce([post({ id: "p3" })]);

    const result = await recommendForReport({
      verdict: "v",
      narrative: "n",
      actionPlan: [action(), action(), action()],
    });

    expect(result).toEqual([
      { actionIndex: 0, postId: "p1", gloss: "" },
      { actionIndex: 1, postId: "p2", gloss: "" },
      { actionIndex: 2, postId: "p3", gloss: "" },
    ]);
    expect(findSimilarPostsMock).toHaveBeenCalledTimes(3);
  });

  it("passes SIMILARITY_THRESHOLD as maxDistance on every per-action call", async () => {
    findSimilarPostsMock.mockResolvedValue([]);
    await recommendForReport({
      verdict: "v",
      narrative: "n",
      actionPlan: [action(), action()],
    });
    const calls = findSimilarPostsMock.mock.calls;
    // 2 per-action + 1 fallback = 3 calls
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect((calls[0][0] as MockedFindSimilarPostsCall).maxDistance).toBe(
      SIMILARITY_THRESHOLD,
    );
    expect((calls[0][0] as MockedFindSimilarPostsCall).limit).toBe(1);
    expect((calls[0][0] as MockedFindSimilarPostsCall).visibility).toBe(
      "public",
    );
  });
});

describe("recommendForReport — dedupe across actions", () => {
  it("first action wins when two actions return the same post", async () => {
    findSimilarPostsMock
      .mockResolvedValueOnce([post({ id: "same" })])
      .mockResolvedValueOnce([post({ id: "same" })])
      .mockResolvedValueOnce([post({ id: "different" })]);

    const result = await recommendForReport({
      verdict: "v",
      narrative: "n",
      actionPlan: [action(), action(), action()],
    });

    expect(result).toEqual([
      { actionIndex: 0, postId: "same", gloss: "" },
      { actionIndex: 2, postId: "different", gloss: "" },
    ]);
  });
});

describe("recommendForReport — partial failure resilience", () => {
  it("ignores a rejected per-action call and proceeds with the rest", async () => {
    findSimilarPostsMock
      .mockResolvedValueOnce([post({ id: "p1" })])
      .mockRejectedValueOnce(new Error("embedding outage"))
      .mockResolvedValueOnce([post({ id: "p3" })]);

    const result = await recommendForReport({
      verdict: "v",
      narrative: "n",
      actionPlan: [action(), action(), action()],
    });

    expect(result).toEqual([
      { actionIndex: 0, postId: "p1", gloss: "" },
      { actionIndex: 2, postId: "p3", gloss: "" },
    ]);
  });

  it("ignores an action whose ANN returned [] (below threshold)", async () => {
    findSimilarPostsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([post({ id: "p2" })]);

    const result = await recommendForReport({
      verdict: "v",
      narrative: "n",
      actionPlan: [action(), action()],
    });

    expect(result).toEqual([{ actionIndex: 1, postId: "p2", gloss: "" }]);
  });
});

describe("recommendForReport — fallback to per-report search", () => {
  it("uses verdict+narrative when every per-action call returns []", async () => {
    findSimilarPostsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        post({ id: "fb1" }),
        post({ id: "fb2" }),
        post({ id: "fb3" }),
      ]);

    const result = await recommendForReport({
      verdict: "Critical AI readiness gap",
      narrative: "Your program has foundational issues...",
      actionPlan: [action(), action(), action()],
    });

    expect(result).toEqual([
      { actionIndex: -1, postId: "fb1", gloss: "" },
      { actionIndex: -1, postId: "fb2", gloss: "" },
      { actionIndex: -1, postId: "fb3", gloss: "" },
    ]);

    // The 4th call (fallback) embeds verdict + narrative.
    const lastCall = findSimilarPostsMock.mock.calls[3][0] as MockedFindSimilarPostsCall;
    expect(lastCall.queryText.title).toBe("Critical AI readiness gap");
    expect(lastCall.queryText.excerpt).toContain("foundational issues");
    expect(lastCall.limit).toBe(3);
  });

  it("returns [] when even the fallback returns nothing", async () => {
    findSimilarPostsMock.mockResolvedValue([]);
    const result = await recommendForReport({
      verdict: "v",
      narrative: "n",
      actionPlan: [action()],
    });
    expect(result).toEqual([]);
  });

  it("returns [] when the fallback throws (quiet fail)", async () => {
    findSimilarPostsMock
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("fallback embedding fails"));

    const result = await recommendForReport({
      verdict: "v",
      narrative: "n",
      actionPlan: [action()],
    });
    expect(result).toEqual([]);
  });
});

describe("recommendForReport — MAX_PER_REPORT cap", () => {
  it("caps at 5 even if more actions return unique posts", async () => {
    findSimilarPostsMock
      .mockResolvedValueOnce([post({ id: "p1" })])
      .mockResolvedValueOnce([post({ id: "p2" })])
      .mockResolvedValueOnce([post({ id: "p3" })])
      .mockResolvedValueOnce([post({ id: "p4" })])
      .mockResolvedValueOnce([post({ id: "p5" })])
      .mockResolvedValueOnce([post({ id: "p6" })])
      .mockResolvedValueOnce([post({ id: "p7" })]);

    const result = await recommendForReport({
      verdict: "v",
      narrative: "n",
      actionPlan: [
        action(),
        action(),
        action(),
        action(),
        action(),
        action(),
        action(),
      ],
    });

    expect(result).toHaveLength(5);
    expect(result.map((r) => r.postId)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
    ]);
  });
});
