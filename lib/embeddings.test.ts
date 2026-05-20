import { describe, expect, it } from "vitest";
import { buildEmbeddingText, EMBEDDING_DIMS } from "./embeddings";

describe("buildEmbeddingText", () => {
  it("includes the title", () => {
    const text = buildEmbeddingText({
      title: "Why data lineage matters",
      excerpt: null,
      contentMd: null,
    });
    expect(text).toContain("Why data lineage matters");
  });

  it("includes excerpt when present", () => {
    const text = buildEmbeddingText({
      title: "Title",
      excerpt: "An excerpt about lineage.",
      contentMd: null,
    });
    expect(text).toContain("An excerpt about lineage.");
  });

  it("skips excerpt when null", () => {
    const text = buildEmbeddingText({
      title: "Title",
      excerpt: null,
      contentMd: "body content",
    });
    expect(text).toBe("Title\n\nbody content");
  });

  it("truncates body to 1500 chars", () => {
    const longBody = "x".repeat(2000);
    const text = buildEmbeddingText({
      title: "Title",
      excerpt: null,
      contentMd: longBody,
    });
    // parts.join("\n\n") with 2 parts → 1 separator (2 chars).
    // title (5) + "\n\n" (2) + 1500 chars of body = 1507
    expect(text.length).toBe(5 + 2 + 1500);
  });

  it("returns only title when no excerpt or body", () => {
    expect(
      buildEmbeddingText({ title: "Solo", excerpt: null, contentMd: null }),
    ).toBe("Solo");
  });

  it("composes title + excerpt + body in that order", () => {
    const text = buildEmbeddingText({
      title: "T",
      excerpt: "E",
      contentMd: "B",
    });
    expect(text).toBe("T\n\nE\n\nB");
  });
});

describe("EMBEDDING_DIMS", () => {
  it("matches the pgvector column width", () => {
    // The post.embedding column is vector(1024). If you change this,
    // you MUST run a migration to widen / narrow the column and
    // re-embed every existing post.
    expect(EMBEDDING_DIMS).toBe(1024);
  });
});
