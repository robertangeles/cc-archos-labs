import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOG_AGENT_CONFIG_STARTER, type BlogAgentConfig } from "./config-shared";

// createPost commits before attachIllustration runs. Without a review hold in
// between, a run that dies in that window leaves a post that is ALREADY
// publishable with a blank featured slot — and because the queue item stays
// `running`, the sweeper reclaims it and the retry writes a second post that
// takes the post_id pointer, orphaning the first.
//
// Both image-less posts on PROD were created exactly that way. The check that
// matters is the ORDER: held at create, cleared only after the illustration.

const createPost = vi.fn();
const attachImageToPost = vi.fn();
const attachFallbackImageToPost = vi.fn();
const generatePostImage = vi.fn();
const releaseItem = vi.fn();
const addInternalLinks = vi.fn();

/** Records every step in the order it happened, so ordering is assertable. */
const calls: string[] = [];

const dbUpdate = vi.fn(() => ({
  set: (patch: Record<string, unknown>) => ({
    where: async () => {
      calls.push(`update:${JSON.stringify(patch)}`);
    },
  }),
}));

// claimPublishSlot reads future scheduled posts; it only needs to resolve.
const dbSelect = vi.fn(() => ({
  from: () => ({ where: async () => [] }),
}));

vi.mock("../db", () => ({
  getDb: () => ({ update: dbUpdate, select: dbSelect }),
}));
vi.mock("../posts-admin", () => ({
  createPost: (...a: unknown[]) => {
    const input = a[0] as { needsReview?: boolean };
    calls.push(`createPost:needsReview=${input.needsReview}`);
    return createPost(...a);
  },
}));
vi.mock("./image", () => ({
  generatePostImage: (...a: unknown[]) => generatePostImage(...a),
}));
vi.mock("../posts-admin/attach-image", () => ({
  attachImageToPost: (...a: unknown[]) => {
    calls.push("attachImage");
    return attachImageToPost(...a);
  },
  attachFallbackImageToPost: (...a: unknown[]) => {
    calls.push("attachFallback");
    return attachFallbackImageToPost(...a);
  },
}));
vi.mock("./internal-links", () => ({
  insertInternalLinks: vi.fn(),
}));
vi.mock("../posts/find-similar", () => ({ findSimilarPosts: vi.fn(async () => []) }));
vi.mock("../workflows/executor", () => ({ executeStep: vi.fn(), executeWorkflow: vi.fn() }));
vi.mock("../rules/service", () => ({
  getEnabledRules: vi.fn(),
  formatRulesForInjection: vi.fn(),
}));
vi.mock("./judge", () => ({ judgeDraft: vi.fn() }));
vi.mock("./config", () => ({
  getBlogAgentConfig: vi.fn(),
  getJudgePrompt: vi.fn(),
  isDueToday: vi.fn(),
  nextFreeSlot: vi.fn(() => new Date("2026-08-11T07:00:00Z")),
}));
vi.mock("./queue", () => ({
  claimNextItem: vi.fn(),
  releaseItem: (...a: unknown[]) => {
    calls.push("releaseItem");
    return releaseItem(...a);
  },
  sweepStaleLocks: vi.fn(),
}));

const { finish } = await import("./run");

const PARSED = {
  title: "A Title",
  slug: "a-title",
  excerpt: "An excerpt.",
  contentMd: "body",
  seoTitle: "A Title",
  seoDescription: "A description.",
  tags: [] as string[],
};

function config(over: Partial<BlogAgentConfig> = {}): BlogAgentConfig {
  return { ...BLOG_AGENT_CONFIG_STARTER, ...over };
}

async function runFinish() {
  return finish(
    config(),
    { id: "item-1", categoryId: "cat-1" } as never,
    PARSED as never,
    "body",
    "SCENE: a lobby.\nALT: a lobby.",
    {},
    new Date("2026-08-10T00:00:00Z"),
    undefined,
  );
}

afterEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("finish — publish hold", () => {
  it("creates the post held, then clears the hold only after the illustration", async () => {
    createPost.mockResolvedValue({ post: { id: "post-1" } });
    generatePostImage.mockResolvedValue({ buffer: Buffer.from("i"), alt: "a lobby." });
    addInternalLinks.mockResolvedValue("body");

    await runFinish();

    expect(calls).toEqual([
      "createPost:needsReview=true",
      "attachImage",
      'update:{"needsReview":false}',
      "releaseItem",
    ]);
  });

  it("still clears the hold when the illustration falls back to the house asset", async () => {
    createPost.mockResolvedValue({ post: { id: "post-1" } });
    // No image produced — attachIllustration falls through to the house asset.
    generatePostImage.mockResolvedValue(null);

    await runFinish();

    expect(calls).toEqual([
      "createPost:needsReview=true",
      "attachFallback",
      'update:{"needsReview":false}',
      "releaseItem",
    ]);
  });

  it("leaves the post unpublishable when the run dies before the hold is cleared", async () => {
    createPost.mockResolvedValue({ post: { id: "post-1" } });
    generatePostImage.mockRejectedValue(new Error("R2 down"));
    attachFallbackImageToPost.mockRejectedValue(new Error("house asset missing"));

    await runFinish();

    // Both image paths failed. The hold must still be cleared ONLY after both
    // were attempted — never before — so a hard crash inside attachIllustration
    // cannot leave a publishable post with no image.
    const holdCleared = calls.indexOf('update:{"needsReview":false}');
    const created = calls.indexOf("createPost:needsReview=true");
    expect(created).toBe(0);
    expect(holdCleared).toBeGreaterThan(created);
  });
});
