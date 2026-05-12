import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeParseError } from "./errors/booking";

// Contract:
//   - happy paths return Zod-validated, typed results
//   - shape mismatches throw ClaudeParseError (so the caller can log + degrade)
//   - underlying transport failures degrade to {null, costUsd: null}
//   - blog match strips Claude-hallucinated URLs that aren't in the input list
//   - cost estimation produces a positive number proportional to tokens
//
// We mock lib/claude.ts's generateStructured via vi.mock so no real HTTP
// fires. The Claude eval suites (Phase 1.E follow-up) hit real Claude;
// these unit tests focus on the parse + validate + degrade contracts.

vi.mock("./claude", () => ({
  generateStructured: vi.fn(),
  DEFAULT_MODEL_ID: "anthropic/claude-sonnet-4-6",
}));

import { generateStructured } from "./claude";
import {
  generateConversationalFollowup,
  generatePreCallBrief,
  matchBlogPosts,
} from "./claude-booking";

const mockedGenerate = vi.mocked(generateStructured);

beforeEach(() => {
  mockedGenerate.mockReset();
});

afterEach(() => {
  mockedGenerate.mockReset();
});

// ----------------------------------------------------------------------------
// generateConversationalFollowup
// ----------------------------------------------------------------------------

describe("generateConversationalFollowup", () => {
  it("returns the parsed follow-up on the happy path", async () => {
    mockedGenerate.mockResolvedValue({
      data: { shouldFollowUp: true, question: "Is this for you personally or a team?" },
      inputTokens: 200,
      outputTokens: 30,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const result = await generateConversationalFollowup({
      reasonInitial: "I want to hire an AI lead.",
    });
    expect(result.followup?.shouldFollowUp).toBe(true);
    expect(result.followup?.question).toContain("personally");
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("allows shouldFollowUp=false with an empty question", async () => {
    mockedGenerate.mockResolvedValue({
      data: { shouldFollowUp: false, question: "" },
      inputTokens: 200,
      outputTokens: 8,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const result = await generateConversationalFollowup({
      reasonInitial: "Already specific reason.",
    });
    expect(result.followup?.shouldFollowUp).toBe(false);
    expect(result.followup?.question).toBe("");
  });

  it("throws ClaudeParseError when shape is wrong", async () => {
    mockedGenerate.mockResolvedValue({
      data: { shouldFollowUp: "yes please" }, // wrong type, missing question
      inputTokens: 200,
      outputTokens: 10,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    await expect(
      generateConversationalFollowup({ reasonInitial: "x" }),
    ).rejects.toBeInstanceOf(ClaudeParseError);
  });

  it("degrades to null + null cost on transport failure", async () => {
    mockedGenerate.mockRejectedValue(new Error("network exploded"));
    const result = await generateConversationalFollowup({
      reasonInitial: "x",
    });
    expect(result.followup).toBeNull();
    expect(result.costUsd).toBeNull();
  });

  it("truncates oversized reason input before sending", async () => {
    mockedGenerate.mockResolvedValue({
      data: { shouldFollowUp: false, question: "" },
      inputTokens: 100,
      outputTokens: 5,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const huge = "a".repeat(50_000);
    await generateConversationalFollowup({ reasonInitial: huge });
    const call = mockedGenerate.mock.calls[0]![0];
    // The user message embeds the reason; we cap at 2000 chars, so
    // the embedded payload should be much smaller than 50k.
    expect(call.userMessage.length).toBeLessThan(5000);
  });
});

// ----------------------------------------------------------------------------
// generatePreCallBrief
// ----------------------------------------------------------------------------

describe("generatePreCallBrief", () => {
  const validBrief = {
    summary: "Sarah Chen, Head of Eng at Acme (~50 eng).",
    priorityScore: "P1" as const,
    priorityReason: "Decision-maker with a 30-day deadline.",
    talkingPoints: [
      "Map their data foundation first.",
      "Probe whether the CEO pressure has a real deadline.",
      "Surface fractional-vs-FTE economics for their team shape.",
    ],
  };

  it("returns the brief on the happy path", async () => {
    mockedGenerate.mockResolvedValue({
      data: validBrief,
      inputTokens: 400,
      outputTokens: 200,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const result = await generatePreCallBrief({
      prospectName: "Sarah Chen",
      prospectRole: "Head of Engineering",
      prospectOrganisation: "Acme",
      reasonInitial: "decide on AI hire",
      followups: [],
    });
    expect(result.brief?.priorityScore).toBe("P1");
    expect(result.brief?.talkingPoints).toHaveLength(3);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("rejects invalid priorityScore via Zod", async () => {
    mockedGenerate.mockResolvedValue({
      data: { ...validBrief, priorityScore: "P0" },
      inputTokens: 400,
      outputTokens: 200,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    await expect(
      generatePreCallBrief({
        prospectName: "x",
        prospectRole: "y",
        prospectOrganisation: "z",
        reasonInitial: "r",
        followups: [],
      }),
    ).rejects.toBeInstanceOf(ClaudeParseError);
  });

  it("rejects when talkingPoints length is not exactly 3", async () => {
    mockedGenerate.mockResolvedValue({
      data: { ...validBrief, talkingPoints: validBrief.talkingPoints.slice(0, 2) },
      inputTokens: 400,
      outputTokens: 200,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    await expect(
      generatePreCallBrief({
        prospectName: "x",
        prospectRole: "y",
        prospectOrganisation: "z",
        reasonInitial: "r",
        followups: [],
      }),
    ).rejects.toBeInstanceOf(ClaudeParseError);
  });

  it("embeds the followup turn in the user message when present", async () => {
    mockedGenerate.mockResolvedValue({
      data: validBrief,
      inputTokens: 400,
      outputTokens: 200,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    await generatePreCallBrief({
      prospectName: "Sarah",
      prospectRole: "Head of Eng",
      prospectOrganisation: "Acme",
      reasonInitial: "I want to hire an AI lead",
      followups: [
        { question: "Is this for you or a team?", answer: "I lead a 50-eng group" },
      ],
    });
    const call = mockedGenerate.mock.calls[0]![0];
    expect(call.userMessage).toContain("Is this for you or a team?");
    expect(call.userMessage).toContain("I lead a 50-eng group");
  });

  it("notes 'prospect skipped' when followups is empty", async () => {
    mockedGenerate.mockResolvedValue({
      data: validBrief,
      inputTokens: 400,
      outputTokens: 200,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    await generatePreCallBrief({
      prospectName: "Sarah",
      prospectRole: "Head of Eng",
      prospectOrganisation: "Acme",
      reasonInitial: "decision",
      followups: [],
    });
    const call = mockedGenerate.mock.calls[0]![0];
    expect(call.userMessage).toContain("(prospect skipped)");
  });
});

// ----------------------------------------------------------------------------
// matchBlogPosts
// ----------------------------------------------------------------------------

describe("matchBlogPosts", () => {
  const posts = [
    {
      title: "Why most AI programs fail",
      url: "https://archoslabs.xyz/blog/ai-fail",
      summary: "Data foundation issues, not models",
    },
    {
      title: "Hiring an internal AI lead vs partnering",
      url: "https://archoslabs.xyz/blog/internal-vs-partner",
      summary: "Decision framework for mid-sized teams",
    },
    {
      title: "Data architecture for AI workloads",
      url: "https://archoslabs.xyz/blog/data-arch",
      summary: "Lineage, governance, warehouse design",
    },
  ];

  it("returns empty matches immediately without calling Claude when posts list is empty", async () => {
    const result = await matchBlogPosts({
      reasonInitial: "anything",
      posts: [],
    });
    expect(result.matches?.matches).toEqual([]);
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("returns the parsed matches on the happy path", async () => {
    mockedGenerate.mockResolvedValue({
      data: {
        matches: [
          {
            title: posts[1]!.title,
            url: posts[1]!.url,
            reason: "Directly addresses the AI-hire decision",
          },
        ],
      },
      inputTokens: 600,
      outputTokens: 80,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const result = await matchBlogPosts({
      reasonInitial: "Should we hire an internal AI lead?",
      posts,
    });
    expect(result.matches?.matches).toHaveLength(1);
    expect(result.matches?.matches[0]!.url).toBe(posts[1]!.url);
  });

  it("strips Claude-hallucinated URLs that weren't in the input list", async () => {
    mockedGenerate.mockResolvedValue({
      data: {
        matches: [
          {
            title: "Made-up post",
            url: "https://archoslabs.xyz/blog/totally-fake",
            reason: "Hallucinated",
          },
          {
            title: posts[0]!.title,
            url: posts[0]!.url,
            reason: "Real match",
          },
        ],
      },
      inputTokens: 600,
      outputTokens: 80,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const result = await matchBlogPosts({
      reasonInitial: "Why my AI program is stuck",
      posts,
    });
    expect(result.matches?.matches).toHaveLength(1);
    expect(result.matches?.matches[0]!.url).toBe(posts[0]!.url);
  });

  it("degrades to null on a transport failure", async () => {
    mockedGenerate.mockRejectedValue(new Error("network exploded"));
    const result = await matchBlogPosts({
      reasonInitial: "x",
      posts,
    });
    expect(result.matches).toBeNull();
    expect(result.costUsd).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// cost estimation
// ----------------------------------------------------------------------------

describe("cost estimation", () => {
  it("scales with token counts (more tokens → higher cost)", async () => {
    mockedGenerate.mockResolvedValueOnce({
      data: { shouldFollowUp: false, question: "" },
      inputTokens: 100,
      outputTokens: 10,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const cheap = await generateConversationalFollowup({ reasonInitial: "x" });

    mockedGenerate.mockResolvedValueOnce({
      data: { shouldFollowUp: false, question: "" },
      inputTokens: 10_000,
      outputTokens: 1000,
      modelId: "anthropic/claude-sonnet-4-6",
    });
    const expensive = await generateConversationalFollowup({ reasonInitial: "x" });

    expect(expensive.costUsd!).toBeGreaterThan(cheap.costUsd!);
  });
});
