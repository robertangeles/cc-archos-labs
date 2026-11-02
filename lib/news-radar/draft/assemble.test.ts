import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DRAFT_CONFIG } from "./config";
import { parseEssay, type ParsedEssay } from "./essay";
import { assembleDraft, sourcesSection, type AssembleDeps } from "./assemble";
import type { FetchedPage, StoryItem } from "./research";

const ITEM: StoryItem = {
  title: "Qwen3.8 Picks Alibaba Cloud Domains in 40.8% of Runs",
  summary: "s",
  publishedAt: new Date("2026-10-27T21:06:00Z"), // 08:06 on 28 Oct in Melbourne
  sourceUrl: "https://huggingnews.com/ai/qwen38-picks-5f23",
};
const page = (over: Partial<FetchedPage> = {}): FetchedPage => ({
  url: "https://cohere.com/blog/a",
  finalUrl: "https://cohere.com/blog/a",
  title: "Concerning behavior from a popular open-weight AI model | Cohere",
  text: "t",
  kind: "primary",
  what: "w",
  ...over,
});

const META = "Qwen3.8 reportedly picks Alibaba Cloud domains in 40.8% of runs. Cohere's documents show other numbers, a forced condition and one trace, not 10,000 samples.";
const ESSAY = `# Qwen3.8's 40.8% figure is not in Cohere's data\n\n*${META}*\n\nThe hook paragraph.\n\nVerdict: unproven. The 40.8% appears in no document.\n\n## What the table shows\n\nBody text.\n---\n\n## SEO Package\n\n**URL slug:** qwen38-check\n**SEO title:** Qwen3.8's 40.8% Figure Checked\n**Meta description:** ${META}\n**Tags:** Qwen3.8, Cohere, Alibaba Cloud, open-weight models, prefill, AI safety\n`;
const parsed = (): ParsedEssay => parseEssay(ESSAY)!;

describe("sourcesSection", () => {
  it("lists each page as a link with its title and host, then the headline with its date", () => {
    const s = sourcesSection([page(), page({ finalUrl: "https://www.huggingface.co/datasets/x", title: "CohereLabs/traces · Datasets at Hugging Face" })], ITEM);
    expect(s).toBe(
      [
        "## Sources",
        "",
        "- [Concerning behavior from a popular open-weight AI model | Cohere](https://cohere.com/blog/a). cohere.com.",
        "- [CohereLabs/traces · Datasets at Hugging Face](https://www.huggingface.co/datasets/x). huggingface.co.",
        `- [${ITEM.title}](${ITEM.sourceUrl}). HuggingNews, 28 October 2026. The headline this piece checks.`,
      ].join("\n"),
    );
  });

  it("uses the URL the page was really fetched from, after redirects", () => {
    expect(sourcesSection([page({ url: "https://cohere.com/old", finalUrl: "https://cohere.com/new" })], ITEM)).toContain("](https://cohere.com/new)");
  });

  it("lists a URL once", () => {
    const s = sourcesSection([page(), page()], ITEM);
    expect(s.match(/cohere\.com\/blog\/a/g)).toHaveLength(1);
  });

  it("cannot be broken by a hostile title or URL", () => {
    const s = sourcesSection([page({ title: "Evil [link](https://evil.example)\n## Injected heading", finalUrl: "https://x.example/a_(b)" })], ITEM);
    expect(s.split("\n").filter((l) => l.startsWith("#"))).toEqual(["## Sources"]); // no extra heading
    expect(s).not.toContain("](https://evil.example)");
    expect(s).toContain("https://x.example/a_%28b%29");
  });

  it("caps a very long title", () => {
    expect(sourcesSection([page({ title: "x".repeat(500) })], ITEM).split("\n")[2].length).toBeLessThan(260);
  });
});

describe("assembleDraft", () => {
  const SLOT = new Date("2026-11-03T14:00:00Z");
  const build = (over: Partial<AssembleDeps> = {}) => {
    const created: unknown[] = [];
    const deps: AssembleDeps = {
      refs: async () => ({ categoryId: "cat-1", authorId: "auth-1" }),
      nextSlot: async () => SLOT,
      slugTaken: async () => false,
      createDraftPost: vi.fn(async (input) => {
        created.push(input);
        return { postId: "post-1", slug: input.slug! };
      }),
      attachImage: vi.fn(async () => {}),
      ...over,
    };
    return { deps, created };
  };
  const input = (over: Record<string, unknown> = {}) => ({
    parsed: parsed(),
    pages: [page()],
    item: ITEM,
    photo: { ok: true as const, buffer: Buffer.from("img"), alt: "alt text", scene: "s", steps: [] },
    now: new Date("2026-11-02T01:00:00Z"),
    ...over,
  });

  it("creates a SCHEDULED draft that needs review, flagged as agent-written, in the right category", async () => {
    const { deps, created } = build();
    const r = await assembleDraft(deps, DEFAULT_DRAFT_CONFIG, input());
    expect(r).toMatchObject({ ok: true, postId: "post-1", slug: "qwen38-check", slot: SLOT, imageAttached: true });
    expect(created[0]).toMatchObject({
      slug: "qwen38-check",
      title: "Qwen3.8's 40.8% figure is not in Cohere's data",
      excerpt: META,
      seoTitle: "Qwen3.8's 40.8% Figure Checked",
      seoDescription: META,
      authorId: "auth-1",
      categoryId: "cat-1",
      status: "scheduled",
      scheduledPublishAt: SLOT,
      visibility: "listed",
      needsReview: true,
      isAgentGenerated: true,
    });
    expect((created[0] as { tags: string[] }).tags).toHaveLength(6);
  });

  it("puts the essay, then sources, in the body, with no related-reading list (the blog page's Read next does that)", async () => {
    const { deps, created } = build();
    await assembleDraft(deps, DEFAULT_DRAFT_CONFIG, input());
    const body = (created[0] as { contentMd: string }).contentMd;
    expect(body.indexOf("Body text.")).toBeLessThan(body.indexOf("## Sources"));
    expect(body.startsWith("The hook paragraph.")).toBe(true);
    expect(body).not.toContain("SEO Package");
    expect(body).not.toMatch(/Related reading/i);
    expect(body).not.toMatch(/\n---\s*\n+## Sources/); // the writer's trailing rule is gone
  });

  it("attaches the photo with its alt text", async () => {
    const { deps } = build();
    await assembleDraft(deps, DEFAULT_DRAFT_CONFIG, input());
    expect(deps.attachImage).toHaveBeenCalledWith("post-1", "qwen38-check", Buffer.from("img"), "alt text");
  });

  it("makes the draft without a picture when the photo step gave nothing", async () => {
    const { deps } = build();
    const r = await assembleDraft(deps, DEFAULT_DRAFT_CONFIG, input({ photo: { ok: false, note: "image failed", steps: [] } }));
    expect(r).toMatchObject({ ok: true, imageAttached: false });
    expect(deps.attachImage).not.toHaveBeenCalled();
  });

  it("keeps the post when attaching the picture fails", async () => {
    const { deps } = build({ attachImage: vi.fn(async () => { throw new Error("R2 down"); }) });
    const r = await assembleDraft(deps, DEFAULT_DRAFT_CONFIG, input());
    expect(r).toMatchObject({ ok: true, imageAttached: false });
    if (r.ok) expect(r.notes.join()).toMatch(/picture|image/i);
  });

  it("stops with missing_setup when the category or author is not there", async () => {
    const { deps } = build({ refs: async () => null });
    expect(await assembleDraft(deps, DEFAULT_DRAFT_CONFIG, input())).toMatchObject({ ok: false, reason: "missing_setup" });
    expect(deps.createDraftPost).not.toHaveBeenCalled();
  });

  it("finds a free slug when the first is taken", async () => {
    const taken = new Set(["qwen38-check", "qwen38-check-2"]);
    const { deps, created } = build({ slugTaken: async (s) => taken.has(s) });
    await assembleDraft(deps, DEFAULT_DRAFT_CONFIG, input());
    expect((created[0] as { slug: string }).slug).toBe("qwen38-check-3");
  });

  it("asks for the slot at the moment of creation, not earlier", async () => {
    const nextSlot = vi.fn(async () => SLOT);
    const { deps } = build({ nextSlot });
    const now = new Date("2026-11-02T01:00:00Z");
    await assembleDraft(deps, DEFAULT_DRAFT_CONFIG, input({ now }));
    expect(nextSlot).toHaveBeenCalledWith(now);
  });

  it("never schedules in the past: a slot that is not in the future stops the job", async () => {
    const { deps } = build({ nextSlot: async () => new Date("2026-11-01T00:00:00Z") });
    expect(await assembleDraft(deps, DEFAULT_DRAFT_CONFIG, input())).toMatchObject({ ok: false });
  });
});
