import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MarkdownArticle, stripLeadingH1 } from "./markdown-article";
import type { PublishedPageView } from "../../lib/pages/types";

// LOAD-BEARING SECURITY TEST.
//
// react-markdown's default config does NOT render raw HTML — but a
// future PR adding `rehype-raw` (e.g. to support embedded iframes) would
// silently re-introduce the XSS vector. This file proves that every
// well-known XSS payload, when fed into a page's content_md, renders as
// literal text in the output HTML.
//
// If you find yourself disabling these tests to enable a feature, STOP.
// The fix is to sanitise at the renderer (rehype-sanitize) or keep the
// feature out of markdown.

const xssVectors: Array<{ name: string; payload: string }> = [
  {
    name: "raw <script> tag",
    payload: "<script>alert(1)</script>",
  },
  {
    name: "<img onerror=...>",
    payload: '<img src="x" onerror="alert(1)">',
  },
  {
    name: "<iframe src=javascript:...>",
    payload: '<iframe src="javascript:alert(1)"></iframe>',
  },
  {
    name: "<svg onload=...>",
    payload: '<svg onload="alert(1)"></svg>',
  },
  {
    name: "javascript: in markdown link",
    payload: "[click me](javascript:alert(1))",
  },
  {
    name: "data: in markdown link",
    payload: "[click me](data:text/html,<script>alert(1)</script>)",
  },
  {
    name: "inline event handler in surrounding HTML",
    payload: '<a href="https://example.com" onclick="alert(1)">link</a>',
  },
];

function mockPage(contentMd: string): PublishedPageView {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "test-page",
    title: "Test Page",
    contentMd,
    excerpt: null,
    seoTitle: null,
    seoDescription: null,
    template: "long_form",
    ogType: "article",
    publishedAt: now,
    lastReviewedAt: now,
    updatedAt: now,
  };
}

// The key insight: react-markdown renders raw HTML in source as ESCAPED
// text. `<script>alert(1)</script>` becomes `&lt;script&gt;alert(1)&lt;/script&gt;`
// in the output — literal text, never executed. The regexes below check
// for LITERAL unescaped attack patterns: a real `<` followed by a real
// tag name and event handler. Escaped entity sequences pass these checks
// because `&lt;` is not `<`.

// Inline event handlers, scoped to LITERAL element openings. The leading
// `<\w` requires a real opening tag, not the escaped `&lt;`.
const LITERAL_EVENT_HANDLER =
  /<\w+[^>]*\s(?:on(?:load|error|click|focus|blur|mouseover|mouseout|change|submit|input|keydown|keyup|abort))\s*=/i;

describe("MarkdownArticle — XSS resistance", () => {
  for (const { name, payload } of xssVectors) {
    it(`neutralises ${name}`, () => {
      const html = renderToString(<MarkdownArticle page={mockPage(payload)} />);

      // No literal opening <script>, <iframe>, <svg> with active handler
      expect(html).not.toMatch(/<script[\s>]/i);
      expect(html).not.toMatch(/<iframe[\s>]/i);
      expect(html).not.toMatch(/<svg[^>]*onload=/i);

      // No literal element with an inline event handler
      expect(html).not.toMatch(LITERAL_EVENT_HANDLER);

      // No javascript:/data:text/html URL schemes in literal href/src
      expect(html).not.toMatch(/href=["']javascript:/i);
      expect(html).not.toMatch(/href=["']data:text\/html/i);
      expect(html).not.toMatch(/src=["']javascript:/i);
    });
  }

  it("renders an HTML <script> payload as ESCAPED text (defence proof)", () => {
    // Proves the safety mechanism: the dangerous string still appears
    // in the output, but as HTML entities. The browser will display
    // "<script>alert(1)</script>" as literal characters, never execute.
    const html = renderToString(
      <MarkdownArticle
        page={mockPage("<script>alert(1)</script>")}
      />,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("alert(1)");
    expect(html).toContain("&lt;/script&gt;");
  });
});

describe("MarkdownArticle — safe rendering", () => {
  it("renders the title in an h1", () => {
    const html = renderToString(
      <MarkdownArticle page={mockPage("Body text here.")} />,
    );
    expect(html).toMatch(/<h1[^>]*>Test Page<\/h1>/);
  });

  it("renders a GFM table", () => {
    const md = [
      "| Header | Value |",
      "|---|---|",
      "| a | 1 |",
      "| b | 2 |",
    ].join("\n");
    const html = renderToString(<MarkdownArticle page={mockPage(md)} />);
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<td");
    expect(html).toContain("Header");
    expect(html).toContain("Value");
  });

  it("routes external links with rel=noopener and target=_blank", () => {
    const md = "[Anthropic](https://anthropic.com)";
    const html = renderToString(<MarkdownArticle page={mockPage(md)} />);
    expect(html).toMatch(/<a[^>]*href="https:\/\/anthropic\.com"/);
    expect(html).toMatch(/target="_blank"/);
    expect(html).toMatch(/rel="noopener noreferrer"/);
  });

  it("renders internal links without target=_blank", () => {
    const md = "[Privacy](/privacy)";
    const html = renderToString(<MarkdownArticle page={mockPage(md)} />);
    expect(html).toMatch(/href="\/privacy"/);
    // Internal links use next/link; rendered output should NOT carry
    // the external target= attribute.
    expect(html).not.toMatch(/href="\/privacy"[^>]*target="_blank"/);
  });

  it("renders mailto links without target=_blank", () => {
    const md = "[email me](mailto:rob@archoslabs.xyz)";
    const html = renderToString(<MarkdownArticle page={mockPage(md)} />);
    expect(html).toMatch(/href="mailto:rob@archoslabs\.xyz"/);
    expect(html).not.toMatch(/href="mailto:[^"]*"[^>]*target="_blank"/);
  });

  it("renders without crashing when preview=true (banner moved to catch-all)", () => {
    // Phase 2 moved the draft-preview banner from MarkdownArticle up to
    // the catch-all route so composed + long_form pages get the same
    // banner. The prop is preserved for API compatibility but is now
    // a no-op visually.
    const html = renderToString(
      <MarkdownArticle page={mockPage("body")} preview />,
    );
    expect(html).toContain("Test Page");
  });

  it("renders exactly one H1 when content starts with a markdown heading", () => {
    const md = "# Privacy Policy\n\n**Archos Labs**\nABN 18 379 780 858\n\nBody text.";
    const html = renderToString(<MarkdownArticle page={mockPage(md)} />);
    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
    expect(h1Count).toBe(1);
    // The remaining H1 should be the component's own title, not the
    // stripped markdown heading.
    expect(html).toContain("Test Page");
    expect(html).toContain("ABN 18 379 780 858");
  });

  it("renders exactly one H1 when content has no leading heading", () => {
    const md = "**Archos Labs**\nABN 18 379 780 858\n\nBody text.";
    const html = renderToString(<MarkdownArticle page={mockPage(md)} />);
    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
    expect(h1Count).toBe(1);
  });

  it("does not leak react-markdown's internal `node` prop onto DOM elements", () => {
    // Regression: react-markdown passes an MDAST AST node as a `node`
    // prop to override components. React stringifies it to
    // `node="[object Object]"` if spread to a DOM element. Every
    // override in MarkdownArticle destructures `node` out before
    // spreading.
    const md = [
      "# Heading",
      "",
      "A **paragraph** with *emphasis* and a [link](https://example.com).",
      "",
      "- list",
      "- items",
      "",
      "| Col | Val |",
      "|---|---|",
      "| a | 1 |",
      "",
      "> quote",
      "",
      "`code`",
    ].join("\n");
    const html = renderToString(<MarkdownArticle page={mockPage(md)} />);
    expect(html).not.toContain("node=");
    expect(html).not.toContain("[object Object]");
  });

  it("preserves the ABN string when rendering Privacy-style content", () => {
    // Smoke test the cutover content shape.
    const md = "**Archos Labs**\nABN 18 379 780 858\nVictoria, Australia";
    const html = renderToString(<MarkdownArticle page={mockPage(md)} />);
    expect(html).toContain("ABN 18 379 780 858");
    expect(html).toContain("Victoria");
    expect(html).not.toContain("Pty Ltd");
    expect(html).not.toContain("Sydney");
  });
});

describe("stripLeadingH1", () => {
  it("removes a leading H1 line", () => {
    expect(stripLeadingH1("# Title\n\nBody")).toBe("Body");
  });
  it("removes a leading H1 with extra surrounding blank lines", () => {
    expect(stripLeadingH1("\n\n# Title\n\n\nBody")).toBe("Body");
  });
  it("removes only the FIRST h1, keeps later headings", () => {
    expect(stripLeadingH1("# A\n\n## B\n\n# C")).toBe("## B\n\n# C");
  });
  it("does not touch h2 / h3 / etc.", () => {
    expect(stripLeadingH1("## Subhead\n\nBody")).toBe("## Subhead\n\nBody");
  });
  it("returns content unchanged when there is no leading heading", () => {
    expect(stripLeadingH1("Body text only.")).toBe("Body text only.");
  });
  it("returns empty string for empty input", () => {
    expect(stripLeadingH1("")).toBe("");
  });
});
