// llms-txt.ts — unit tests

import { describe, expect, it } from "vitest";
import { buildLlmsTxt, buildLlmsFullTxt } from "./llms-txt";
import type { LlmsTxtPost } from "./llms-txt";

const posts: LlmsTxtPost[] = [
  {
    slug: "ai-governance-framework",
    title: "AI Governance Framework",
    excerpt: "Board-ready framework for AI program risk.",
    contentMd: "## Why governance matters\n\nBoards need a framework.",
    publishedAt: new Date("2026-05-01"),
  },
  {
    slug: "data-lineage",
    title: "Data Lineage Without Tears",
    excerpt: "How to start lineage that doesn't die in week three.",
    contentMd: "## Start small\n\nPick one decision-critical metric.",
    publishedAt: new Date("2026-03-15"),
  },
  {
    slug: "older-post",
    title: "Older Post",
    excerpt: null,
    contentMd: "Body without excerpt.",
    publishedAt: new Date("2025-09-01"),
  },
];

describe("buildLlmsTxt", () => {
  it("starts with the site name header", () => {
    const out = buildLlmsTxt(posts);
    expect(out).toMatch(/^# Archos Labs/);
  });

  it("includes the site description as a blockquote", () => {
    const out = buildLlmsTxt(posts);
    expect(out).toContain("> Practitioner essays");
  });

  it("lists posts newest first with full URLs", () => {
    const out = buildLlmsTxt(posts);
    const govIdx = out.indexOf("AI Governance Framework");
    const linIdx = out.indexOf("Data Lineage Without Tears");
    expect(govIdx).toBeGreaterThan(-1);
    expect(linIdx).toBeGreaterThan(-1);
    expect(govIdx).toBeLessThan(linIdx);
    expect(out).toContain("https://archoslabs.xyz/blog/ai-governance-framework");
  });

  it("appends the excerpt when present", () => {
    const out = buildLlmsTxt(posts);
    expect(out).toContain("Board-ready framework for AI program risk");
  });

  it("omits excerpt when null", () => {
    const out = buildLlmsTxt(posts);
    const olderLine = out
      .split("\n")
      .find((l) => l.includes("Older Post"));
    expect(olderLine).toBeTruthy();
    expect(olderLine).not.toContain(": ");
  });

  it("respects the limit", () => {
    const out = buildLlmsTxt(posts, 2);
    expect(out).toContain("AI Governance Framework");
    expect(out).toContain("Data Lineage Without Tears");
    expect(out).not.toContain("Older Post");
  });
});

describe("buildLlmsFullTxt", () => {
  it("includes every post's full body", () => {
    const out = buildLlmsFullTxt(posts);
    expect(out).toContain("Boards need a framework");
    expect(out).toContain("Pick one decision-critical metric");
  });

  it("includes URL + date for each post", () => {
    const out = buildLlmsFullTxt(posts);
    expect(out).toContain("URL: https://archoslabs.xyz/blog/ai-governance-framework");
    expect(out).toContain("Date: 2026-05-01");
  });

  it("separates posts with horizontal rules", () => {
    const out = buildLlmsFullTxt(posts);
    const dividers = (out.match(/\n---\n/g) ?? []).length;
    expect(dividers).toBeGreaterThanOrEqual(posts.length);
  });

  it("orders by published_at DESC", () => {
    const out = buildLlmsFullTxt(posts);
    const govIdx = out.indexOf("AI Governance Framework");
    const olderIdx = out.indexOf("Older Post");
    expect(govIdx).toBeLessThan(olderIdx);
  });

  it("includes corpus metadata header", () => {
    const out = buildLlmsFullTxt(posts);
    expect(out).toContain("Posts: 3");
    expect(out).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
  });
});
