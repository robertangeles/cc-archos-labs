import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOG_AGENT_CONFIG_STARTER, type BlogAgentConfig } from "./config-shared";

// Every branch here ends in a post that either carries an illustration or
// visibly does not. The failure that matters is silent: a post that ships with
// a blank featured slot, because generateOgImage (lib/og.ts) is still a stub
// and there is no other image path.

const generatePostImage = vi.fn();
const attachImageToPost = vi.fn();
const attachFallbackImageToPost = vi.fn();

vi.mock("./image", () => ({ generatePostImage: (...a: unknown[]) => generatePostImage(...a) }));
vi.mock("../posts-admin/attach-image", () => ({
  attachImageToPost: (...a: unknown[]) => attachImageToPost(...a),
  attachFallbackImageToPost: (...a: unknown[]) => attachFallbackImageToPost(...a),
}));
// Pulled in transitively by run.ts; none of it runs on this path.
vi.mock("../db", () => ({ getDb: () => ({}) }));
vi.mock("../posts-admin", () => ({ createPost: vi.fn() }));
vi.mock("../workflows/executor", () => ({ executeStep: vi.fn(), executeWorkflow: vi.fn() }));
vi.mock("../rules/service", () => ({
  getEnabledRules: vi.fn(),
  formatRulesForInjection: vi.fn(),
}));
vi.mock("./judge", () => ({ judgeDraft: vi.fn() }));
vi.mock("./queue", () => ({
  claimNextItem: vi.fn(),
  releaseItem: vi.fn(),
  sweepStaleLocks: vi.fn(),
}));

const { attachIllustration } = await import("./run");

const PROMPT = "SCENE: A figure alone in an empty lobby.\nALT: A figure in a lobby.";

function config(over: Partial<BlogAgentConfig> = {}): BlogAgentConfig {
  return { ...BLOG_AGENT_CONFIG_STARTER, ...over };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("attachIllustration", () => {
  it("attaches the generated image and reports no fallback", async () => {
    generatePostImage.mockResolvedValue({
      buffer: Buffer.from("img"),
      alt: "A figure in a lobby.",
    });

    const usedFallback = await attachIllustration(config(), "post-1", "my-slug", PROMPT);

    expect(usedFallback).toBe(false);
    expect(attachImageToPost).toHaveBeenCalledWith({
      postId: "post-1",
      slug: "my-slug",
      buffer: expect.any(Buffer),
      alt: "A figure in a lobby.",
    });
    expect(attachFallbackImageToPost).not.toHaveBeenCalled();
  });

  it("supplies a generic alt when the skill emitted none", async () => {
    // An empty alt would fail the DB's non-empty expectation and, worse, ship
    // an image no screen reader can describe.
    generatePostImage.mockResolvedValue({ buffer: Buffer.from("img"), alt: "" });
    await attachIllustration(config(), "post-1", "my-slug", PROMPT);
    expect(attachImageToPost).toHaveBeenCalledWith(
      expect.objectContaining({ alt: "Archos Labs editorial illustration" }),
    );
  });
});

describe("attachIllustration falls back rather than leaving a post imageless", () => {
  it("when illustrations are switched off in config", async () => {
    const usedFallback = await attachIllustration(
      config({ image: { enabled: false } }),
      "post-1",
      "my-slug",
      PROMPT,
    );
    expect(usedFallback).toBe(true);
    expect(generatePostImage).not.toHaveBeenCalled();
    expect(attachFallbackImageToPost).toHaveBeenCalledWith("post-1");
  });

  it("when the workflow produced no image prompt", async () => {
    // The illustration step can fail or be removed without failing the run.
    for (const empty of ["", "   \n "]) {
      vi.clearAllMocks();
      expect(await attachIllustration(config(), "post-1", "my-slug", empty)).toBe(true);
      expect(generatePostImage).not.toHaveBeenCalled();
      expect(attachFallbackImageToPost).toHaveBeenCalledWith("post-1");
    }
  });

  it("when generation returns nothing", async () => {
    generatePostImage.mockResolvedValue(null);
    expect(await attachIllustration(config(), "post-1", "my-slug", PROMPT)).toBe(true);
    expect(attachFallbackImageToPost).toHaveBeenCalledWith("post-1");
  });

  it("when the upload throws — R2 unconfigured, put failed, decode failed", async () => {
    generatePostImage.mockResolvedValue({ buffer: Buffer.from("img"), alt: "alt" });
    attachImageToPost.mockRejectedValue(new Error("R2 is not configured"));
    expect(await attachIllustration(config(), "post-1", "my-slug", PROMPT)).toBe(true);
    expect(attachFallbackImageToPost).toHaveBeenCalledWith("post-1");
  });
});

describe("attachIllustration never throws — the post is already saved", () => {
  it("swallows a fallback that itself fails", async () => {
    // Losing the image must not lose the article. By this point createPost has
    // committed and the post is worth reviewing with a blank featured slot.
    generatePostImage.mockResolvedValue(null);
    attachFallbackImageToPost.mockRejectedValue(new Error("ENOENT blog-fallback.webp"));
    await expect(
      attachIllustration(config(), "post-1", "my-slug", PROMPT),
    ).resolves.toBe(true);
  });

  it("swallows a generator that throws instead of returning null", async () => {
    generatePostImage.mockRejectedValue(new Error("unexpected"));
    await expect(
      attachIllustration(config(), "post-1", "my-slug", PROMPT),
    ).resolves.toBe(true);
    expect(attachFallbackImageToPost).toHaveBeenCalledWith("post-1");
  });
});
