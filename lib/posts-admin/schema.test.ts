import { describe, expect, it } from "vitest";
import {
  PostCreateSchema,
  PostListQuerySchema,
  PostUpdateSchema,
} from "./schema";

const futureDate = () => new Date(Date.now() + 60 * 60 * 1000); // +1h
const pastDate = () => new Date(Date.now() - 60 * 60 * 1000); // -1h

const baseValidInput = {
  slug: "hello-world",
  title: "Hello world",
  contentMd: "# Hello\n\nWorld.",
  status: "draft" as const,
};

describe("PostCreateSchema — slug", () => {
  it("accepts valid kebab-case slug", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      slug: "good-slug-123",
    });
    expect(result.success).toBe(true);
  });

  it("lower-cases + trims slug", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      slug: "  MIXED-Case  ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.slug).toBe("mixed-case");
  });

  it("rejects empty slug", () => {
    const result = PostCreateSchema.safeParse({ ...baseValidInput, slug: "" });
    expect(result.success).toBe(false);
  });

  it("rejects slug with spaces", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      slug: "has spaces",
    });
    expect(result.success).toBe(false);
  });

  it("rejects slug with leading hyphen", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      slug: "-leading",
    });
    expect(result.success).toBe(false);
  });

  it("rejects slug over 200 chars", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      slug: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe("PostCreateSchema — title", () => {
  it("rejects empty title", () => {
    const result = PostCreateSchema.safeParse({ ...baseValidInput, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      title: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe("PostCreateSchema — contentMd cap", () => {
  it("accepts content at the limit", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      contentMd: "x".repeat(200_000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects content over the limit", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      contentMd: "x".repeat(200_001),
    });
    expect(result.success).toBe(false);
  });
});

describe("PostCreateSchema — status", () => {
  it("accepts draft", () => {
    expect(
      PostCreateSchema.safeParse({ ...baseValidInput, status: "draft" }).success,
    ).toBe(true);
  });

  it("accepts published", () => {
    expect(
      PostCreateSchema.safeParse({ ...baseValidInput, status: "published" })
        .success,
    ).toBe(true);
  });

  it("rejects archived (use DELETE endpoint instead)", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      status: "archived",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown status", () => {
    expect(
      PostCreateSchema.safeParse({
        ...baseValidInput,
        status: "weird" as unknown as "draft",
      }).success,
    ).toBe(false);
  });
});

describe("PostCreateSchema — scheduled invariants", () => {
  it("rejects status=scheduled without scheduledPublishAt", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      status: "scheduled",
    });
    expect(result.success).toBe(false);
  });

  it("rejects status=scheduled with a past scheduledPublishAt", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      status: "scheduled",
      scheduledPublishAt: pastDate().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("accepts status=scheduled with a future scheduledPublishAt", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      status: "scheduled",
      scheduledPublishAt: futureDate().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects status=draft with a scheduledPublishAt set", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      status: "draft",
      scheduledPublishAt: futureDate().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects status=published with a scheduledPublishAt set", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      status: "published",
      scheduledPublishAt: futureDate().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe("PostCreateSchema — tags", () => {
  it("defaults tags to empty array when omitted", () => {
    const result = PostCreateSchema.safeParse(baseValidInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tags).toEqual([]);
  });

  it("accepts an array of tags", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      tags: ["ai", "data-architecture"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts exactly 8 tags (the cap)", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      tags: Array.from({ length: 8 }, (_, i) => `tag${i}`),
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 8 tags", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      tags: Array.from({ length: 9 }, (_, i) => `tag${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("rejects tag with more than 64 chars", () => {
    const result = PostCreateSchema.safeParse({
      ...baseValidInput,
      tags: ["x".repeat(65)],
    });
    expect(result.success).toBe(false);
  });
});

describe("PostUpdateSchema", () => {
  it("requires expectedUpdatedAt", () => {
    const result = PostUpdateSchema.safeParse(baseValidInput);
    expect(result.success).toBe(false);
  });

  it("accepts a valid expectedUpdatedAt", () => {
    const result = PostUpdateSchema.safeParse({
      ...baseValidInput,
      expectedUpdatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("preserves scheduled invariants from base schema", () => {
    const result = PostUpdateSchema.safeParse({
      ...baseValidInput,
      expectedUpdatedAt: new Date().toISOString(),
      status: "scheduled",
      // No scheduledPublishAt — should fail
    });
    expect(result.success).toBe(false);
  });
});

describe("PostListQuerySchema", () => {
  it("defaults to all + page 1 + 25 per page when empty", () => {
    const result = PostListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("all");
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(25);
    }
  });

  it("coerces numeric page/pageSize from strings", () => {
    const result = PostListQuerySchema.safeParse({ page: "3", pageSize: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it("rejects page < 1", () => {
    expect(PostListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });

  it("rejects pageSize > 100", () => {
    expect(PostListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(
      false,
    );
  });

  it("accepts every status value", () => {
    for (const status of [
      "all",
      "draft",
      "scheduled",
      "published",
      "needs_review",
      "archived",
    ]) {
      expect(PostListQuerySchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("rejects unknown status", () => {
    expect(PostListQuerySchema.safeParse({ status: "weird" }).success).toBe(
      false,
    );
  });

  it("accepts a UUID categoryId", () => {
    expect(
      PostListQuerySchema.safeParse({
        categoryId: "00000000-0000-0000-0000-000000000000",
      }).success,
    ).toBe(true);
  });

  it("rejects non-UUID categoryId", () => {
    expect(PostListQuerySchema.safeParse({ categoryId: "not-a-uuid" }).success)
      .toBe(false);
  });
});
