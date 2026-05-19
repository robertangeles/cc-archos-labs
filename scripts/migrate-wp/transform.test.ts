// transform.ts — unit tests
//
// Fixtures cover the Gutenberg HTML shapes we expect from the 2026-05-19
// inventory (zero shortcodes; standard block markup only). If real-world
// posts surface novel patterns during the dry-run, add fixtures here
// before fixing transform.ts so the regression is captured.

import { describe, expect, it } from "vitest";
import {
  countWords,
  getReadingTime,
  htmlToMarkdown,
  normaliseWhitespace,
  slugify,
  transformPost,
} from "./transform";
import type { ExtractedPost } from "./types";

describe("htmlToMarkdown", () => {
  it("converts a plain paragraph", () => {
    expect(htmlToMarkdown("<p>Hello world.</p>")).toBe("Hello world.");
  });

  it("converts headings + paragraphs", () => {
    const html = "<h2>Section</h2><p>Body text.</p>";
    expect(htmlToMarkdown(html)).toBe("## Section\n\nBody text.");
  });

  it("converts unordered lists", () => {
    const html = "<ul><li>One</li><li>Two</li><li>Three</li></ul>";
    expect(htmlToMarkdown(html)).toBe("-   One\n-   Two\n-   Three");
  });

  it("converts ordered lists", () => {
    const html = "<ol><li>First</li><li>Second</li></ol>";
    const md = htmlToMarkdown(html);
    expect(md).toMatch(/1\.\s+First/);
    expect(md).toMatch(/2\.\s+Second/);
  });

  it("converts a link", () => {
    const html = '<p>See <a href="https://example.com">example</a>.</p>';
    expect(htmlToMarkdown(html)).toBe("See [example](https://example.com).");
  });

  it("converts bold and italic", () => {
    const html = "<p>This is <strong>bold</strong> and <em>italic</em>.</p>";
    expect(htmlToMarkdown(html)).toBe("This is **bold** and _italic_.");
  });

  it("converts a blockquote", () => {
    const html = "<blockquote><p>Quoted text.</p></blockquote>";
    expect(htmlToMarkdown(html)).toBe("> Quoted text.");
  });

  it("converts a horizontal rule", () => {
    expect(htmlToMarkdown("<p>A</p><hr><p>B</p>")).toBe("A\n\n---\n\nB");
  });

  it("strips empty paragraphs (Gutenberg spacers)", () => {
    const html = "<p>Before</p><p>&nbsp;</p><p>After</p>";
    expect(htmlToMarkdown(html)).toBe("Before\n\nAfter");
  });

  it("strips fully empty paragraphs", () => {
    const html = "<p>Before</p><p></p><p>After</p>";
    expect(htmlToMarkdown(html)).toBe("Before\n\nAfter");
  });

  it("handles a figure with caption", () => {
    const html =
      '<figure><img src="https://r.com/cat.png" alt="cat"><figcaption>A cat.</figcaption></figure>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![cat](https://r.com/cat.png)");
    expect(md).toContain("_A cat._");
  });

  it("handles a figure without caption", () => {
    const html = '<figure><img src="https://r.com/x.png" alt="x"></figure>';
    expect(htmlToMarkdown(html)).toBe("![x](https://r.com/x.png)");
  });

  it("preserves images outside figures", () => {
    const html = '<p>See <img src="https://r.com/y.png" alt="y"> here.</p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![y](https://r.com/y.png)");
  });

  it("handles inline code", () => {
    const html = "<p>Use <code>pnpm</code> here.</p>";
    expect(htmlToMarkdown(html)).toBe("Use `pnpm` here.");
  });

  it("handles fenced code blocks", () => {
    const html = "<pre><code>const x = 1;\nconst y = 2;</code></pre>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });

  it("handles GFM tables", () => {
    const html =
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
  });

  it("handles a realistic multi-block Gutenberg post snippet", () => {
    const html = `
      <h2>The Problem</h2>
      <p>Most AI programs fail because the data underneath wasn't ready.</p>
      <p>&nbsp;</p>
      <h3>Three patterns</h3>
      <ul>
        <li>Ungoverned data lineage</li>
        <li>Unmodelled domain</li>
        <li>Unvalidated assumptions</li>
      </ul>
      <figure>
        <img src="https://robertangeles.com/wp-content/uploads/2026/03/diagram.png" alt="diagram">
        <figcaption>The three failure modes.</figcaption>
      </figure>
      <p>Read more at <a href="https://example.com">the source</a>.</p>
    `;
    const md = htmlToMarkdown(html);
    expect(md).toContain("## The Problem");
    expect(md).toContain("### Three patterns");
    expect(md).toMatch(/-\s+Ungoverned data lineage/);
    expect(md).toContain("![diagram](https://robertangeles.com/wp-content/uploads/2026/03/diagram.png)");
    expect(md).toContain("_The three failure modes._");
    expect(md).toContain("[the source](https://example.com)");
    // No empty paragraph artefacts.
    expect(md).not.toMatch(/\n{3,}/);
  });
});

describe("normaliseWhitespace", () => {
  it("collapses runs of blank lines", () => {
    expect(normaliseWhitespace("A\n\n\n\nB")).toBe("A\n\nB");
  });

  it("trims trailing spaces per line", () => {
    expect(normaliseWhitespace("A   \nB\t  ")).toBe("A\nB");
  });

  it("trims leading and trailing newlines", () => {
    expect(normaliseWhitespace("\n\nA\n\n")).toBe("A");
  });
});

describe("slugify", () => {
  it("kebab-cases ASCII titles", () => {
    expect(slugify("The Board's AI Governance Gap")).toBe(
      "the-board-s-ai-governance-gap",
    );
  });

  it("is idempotent on already-kebab slugs", () => {
    expect(slugify("ai-governance-framework")).toBe("ai-governance-framework");
  });

  it("strips diacritics", () => {
    expect(slugify("Café résumé")).toBe("cafe-resume");
  });

  it("collapses multiple separators", () => {
    expect(slugify("hello---world___foo")).toBe("hello-world-foo");
  });

  it("returns empty for whitespace-only input", () => {
    expect(slugify("   ")).toBe("");
  });

  it("caps length at 200", () => {
    const long = "a".repeat(300);
    expect(slugify(long).length).toBe(200);
  });
});

describe("countWords", () => {
  it("returns 0 for empty input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("counts simple words", () => {
    expect(countWords("hello world")).toBe(2);
  });

  it("counts across multiple lines", () => {
    expect(countWords("line one\nline two\n\nline three")).toBe(6);
  });
});

describe("getReadingTime", () => {
  it("returns 1 for empty content (never zero)", () => {
    expect(getReadingTime("")).toBe(1);
  });

  it("returns 1 for short content (<200 words)", () => {
    expect(getReadingTime("ten words ".repeat(10))).toBe(1);
  });

  it("rounds up at 200 wpm", () => {
    // 1200 words = 6 minutes
    const md = Array(1200).fill("word").join(" ");
    expect(getReadingTime(md)).toBe(6);
  });

  it("rounds up partial minutes", () => {
    // 201 words = ceil(201/200) = 2
    const md = Array(201).fill("w").join(" ");
    expect(getReadingTime(md)).toBe(2);
  });
});

describe("transformPost", () => {
  function makeFixture(overrides: Partial<ExtractedPost> = {}): ExtractedPost {
    return {
      sourceWpId: 1,
      slug: "test-post",
      title: "Test Post",
      rawHtml: "<p>Hello.</p>",
      rawExcerpt: "",
      publishedAt: new Date("2026-05-01"),
      modifiedAt: new Date("2026-05-01"),
      author: {
        sourceUserId: 1,
        userLogin: "robangeles",
        displayName: "Rob Angeles",
      },
      category: {
        sourceTermId: 1,
        name: "AI as Strategy",
        slug: "ai-as-strategy",
      },
      tags: [],
      featuredImage: null,
      yoastFocusKeyphrase: null,
      ...overrides,
    };
  }

  it("converts the post body and computes derived fields", () => {
    const post = makeFixture({
      rawHtml: "<h2>Section</h2><p>" + "word ".repeat(400) + "</p>",
    });
    const result = transformPost(post);
    expect(result.contentMd).toContain("## Section");
    expect(result.wordCount).toBeGreaterThanOrEqual(400);
    expect(result.readingTimeMin).toBe(3); // 401 words / 200 = 2.005 → 3
  });

  it("preserves identity fields", () => {
    const post = makeFixture();
    const result = transformPost(post);
    expect(result.sourceWpId).toBe(post.sourceWpId);
    expect(result.slug).toBe(post.slug);
    expect(result.title).toBe(post.title);
    expect(result.author).toEqual(post.author);
    expect(result.category).toEqual(post.category);
  });

  it("handles empty bodies", () => {
    const post = makeFixture({ rawHtml: "" });
    const result = transformPost(post);
    expect(result.contentMd).toBe("");
    expect(result.wordCount).toBe(0);
    expect(result.readingTimeMin).toBe(1);
  });
});
