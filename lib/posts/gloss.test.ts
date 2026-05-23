import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude wrapper. We don't make real OpenRouter calls in
// unit tests — those are covered by the eval suite (E8) which runs
// nightly against the prod API.
const generateStructuredMock = vi.fn();

vi.mock("../claude", () => ({
  generateStructured: generateStructuredMock,
}));

// Mock the prompt loader so we don't hit the DB. We're testing
// behaviour, not loader integration (that's covered separately).
vi.mock("../post-gloss", () => ({
  getPostGlossPrompts: async () => ({
    gloss: {
      systemPrompt: "test-prompt-systemPrompt",
      version: "test-v1",
    },
  }),
}));

const { generatePostGlosses } = await import("./gloss");

const POSTS = [
  { id: "p1", title: "Post One", excerpt: "Excerpt one." },
  { id: "p2", title: "Post Two", excerpt: "Excerpt two." },
  { id: "p3", title: "Post Three", excerpt: null },
];

beforeEach(() => {
  generateStructuredMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("generatePostGlosses — happy path", () => {
  it("returns gloss map keyed by postId for posts Claude returned", async () => {
    generateStructuredMock.mockResolvedValue({
      data: {
        glosses: {
          p1: "Argues why data lineage matters when stakes are this high.",
          p2: "Tackles the governance gap your assessment flagged as critical.",
        },
      },
      inputTokens: 200,
      outputTokens: 60,
      modelId: "anthropic/claude-sonnet-4-6",
    });

    const result = await generatePostGlosses({
      context: "Your AI program has foundational gaps...",
      posts: POSTS,
    });

    expect(result).toEqual({
      p1: "Argues why data lineage matters when stakes are this high.",
      p2: "Tackles the governance gap your assessment flagged as critical.",
    });
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
  });

  it("trims gloss whitespace and skips empty strings", async () => {
    generateStructuredMock.mockResolvedValue({
      data: {
        glosses: {
          p1: "   Real gloss with leading/trailing whitespace.   ",
          p2: "   ", // whitespace-only — should be dropped
          p3: "",     // empty — should be dropped
        },
      },
      inputTokens: 100,
      outputTokens: 30,
      modelId: "anthropic/claude-sonnet-4-6",
    });

    const result = await generatePostGlosses({
      context: "ctx",
      posts: POSTS,
    });

    expect(result).toEqual({
      p1: "Real gloss with leading/trailing whitespace.",
    });
  });
});

describe("generatePostGlosses — hallucination defense", () => {
  it("discards gloss for post ids that weren't in the input", async () => {
    generateStructuredMock.mockResolvedValue({
      data: {
        glosses: {
          p1: "Valid post id.",
          "hallucinated-id-xyz": "Claude invented this id.",
          p99: "Also not in input.",
        },
      },
      inputTokens: 200,
      outputTokens: 60,
      modelId: "anthropic/claude-sonnet-4-6",
    });

    const result = await generatePostGlosses({
      context: "ctx",
      posts: POSTS,
    });

    expect(result).toEqual({ p1: "Valid post id." });
    expect(result).not.toHaveProperty("hallucinated-id-xyz");
    expect(result).not.toHaveProperty("p99");
  });
});

describe("generatePostGlosses — degradation paths", () => {
  it("returns empty object when generateStructured throws (Claude outage)", async () => {
    generateStructuredMock.mockRejectedValue(new Error("OpenRouter 503"));
    const result = await generatePostGlosses({
      context: "ctx",
      posts: POSTS,
    });
    expect(result).toEqual({});
  });

  it("returns empty object when Claude returns wrong shape", async () => {
    generateStructuredMock.mockResolvedValue({
      data: { wrong: "shape" }, // no `glosses` key
      inputTokens: 50,
      outputTokens: 10,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const result = await generatePostGlosses({
      context: "ctx",
      posts: POSTS,
    });
    expect(result).toEqual({});
  });

  it("returns empty object when glosses object is malformed (non-string values)", async () => {
    generateStructuredMock.mockResolvedValue({
      data: { glosses: { p1: 42, p2: { nested: "obj" } } }, // not strings
      inputTokens: 50,
      outputTokens: 10,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const result = await generatePostGlosses({
      context: "ctx",
      posts: POSTS,
    });
    // safeParse fails because record values aren't strings → empty map.
    expect(result).toEqual({});
  });

  it("returns empty object when posts array is empty (no Claude call)", async () => {
    const result = await generatePostGlosses({
      context: "ctx",
      posts: [],
    });
    expect(result).toEqual({});
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });
});

describe("generatePostGlosses — payload shape", () => {
  it("truncates context to 2000 chars and excerpts to 400 chars", async () => {
    generateStructuredMock.mockResolvedValue({
      data: { glosses: {} },
      inputTokens: 50,
      outputTokens: 5,
      modelId: "anthropic/claude-sonnet-4-6",
    });

    const longContext = "x".repeat(3000);
    const longExcerpt = "y".repeat(800);
    await generatePostGlosses({
      context: longContext,
      posts: [{ id: "p1", title: "T", excerpt: longExcerpt }],
    });

    const call = generateStructuredMock.mock.calls[0][0];
    const userMessage = JSON.parse(call.userMessage);
    expect(userMessage.context).toHaveLength(2000);
    expect(userMessage.posts[0].excerpt).toHaveLength(400);
  });

  it("coerces null excerpt to empty string in payload", async () => {
    generateStructuredMock.mockResolvedValue({
      data: { glosses: {} },
      inputTokens: 10,
      outputTokens: 5,
      modelId: "anthropic/claude-sonnet-4-6",
    });

    await generatePostGlosses({
      context: "ctx",
      posts: [{ id: "p1", title: "T", excerpt: null }],
    });

    const call = generateStructuredMock.mock.calls[0][0];
    const userMessage = JSON.parse(call.userMessage);
    expect(userMessage.posts[0].excerpt).toBe("");
  });
});
