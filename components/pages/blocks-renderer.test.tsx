import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BlocksRenderer } from "./blocks-renderer";
import type { PageBlock } from "../../lib/db/schema";

// Synthesises a PageBlock row. The schema's date columns aren't read by
// BlocksRenderer so any Date placeholder is fine.
function row(
  blockType: string,
  props: Record<string, unknown>,
  position = 0,
): PageBlock {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id: `00000000-0000-0000-0000-${String(position).padStart(12, "0")}`,
    pageId: "00000000-0000-0000-0000-000000000000",
    blockType,
    position,
    props,
    createdAt: now,
    updatedAt: now,
  } as unknown as PageBlock;
}

describe("BlocksRenderer — empty state", () => {
  it("renders nothing in public mode when there are no blocks", () => {
    const html = renderToString(<BlocksRenderer blocks={[]} />);
    expect(html).toBe("");
  });

  it("renders an empty-state hint in preview mode", () => {
    const html = renderToString(<BlocksRenderer blocks={[]} preview />);
    expect(html).toMatch(/has no blocks yet/i);
  });
});

describe("BlocksRenderer — unknown block_type", () => {
  it("renders the public placeholder, not the internals", () => {
    const html = renderToString(
      <BlocksRenderer blocks={[row("nonexistent", {})]} />,
    );
    expect(html).toMatch(/block unavailable/i);
    expect(html).not.toMatch(/nonexistent/i);
  });

  it("renders the admin warning in preview mode", () => {
    const html = renderToString(
      <BlocksRenderer blocks={[row("nonexistent", {})]} preview />,
    );
    expect(html).toMatch(/Block render failed/);
    expect(html).toMatch(/unknown block type: nonexistent/);
  });
});

describe("BlocksRenderer — invalid props", () => {
  it("renders the placeholder when hero is missing headline", () => {
    const bad = row("hero", { eyebrow: "x", subhead: "y" });
    const html = renderToString(<BlocksRenderer blocks={[bad]} />);
    expect(html).toMatch(/block unavailable/i);
  });

  it("surfaces the failing field path in preview", () => {
    const bad = row("hero", { eyebrow: "x", subhead: "y" });
    const html = renderToString(<BlocksRenderer blocks={[bad]} preview />);
    expect(html).toMatch(/headline/i);
  });
});

describe("BlocksRenderer — happy path", () => {
  it("renders a hero with the headline text", () => {
    const block = row("hero", {
      eyebrow: "About",
      headline: "We help programs that can't afford to get it wrong.",
      subhead: "Senior data + AI consulting.",
    });
    const html = renderToString(<BlocksRenderer blocks={[block]} />);
    expect(html).toContain("We help programs that can&#x27;t afford");
  });

  it("renders a proof_grid with each item's outcome", () => {
    const block = row("proof_grid", {
      heading: "What clients ship",
      items: [
        { label: "Outcome", outcome: "first concrete result" },
        { label: "Outcome", outcome: "second concrete result" },
      ],
    });
    const html = renderToString(<BlocksRenderer blocks={[block]} />);
    expect(html).toContain("first concrete result");
    expect(html).toContain("second concrete result");
  });

  it("renders blocks in position order regardless of array order", () => {
    const a = row("markdown", { content: "AAA" }, 1);
    const b = row("markdown", { content: "BBB" }, 0);
    const html = renderToString(<BlocksRenderer blocks={[a, b]} />);
    // BBB (position 0) must appear before AAA (position 1)
    expect(html.indexOf("BBB")).toBeLessThan(html.indexOf("AAA"));
  });
});

describe("BlocksRenderer — XSS regression per block_type", () => {
  // Same posture as MarkdownArticle's XSS test: literal raw HTML inside
  // any block's props must render as escaped text, never as live DOM.
  const XSS = '<script>alert(1)</script>';

  it("markdown block escapes <script>", () => {
    const html = renderToString(
      <BlocksRenderer blocks={[row("markdown", { content: XSS })]} />,
    );
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("hero block escapes <script> in headline", () => {
    const html = renderToString(
      <BlocksRenderer
        blocks={[
          row("hero", {
            eyebrow: "x",
            headline: XSS,
            subhead: "y",
          }),
        ]}
      />,
    );
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("proof_grid block escapes <script> in outcome", () => {
    const html = renderToString(
      <BlocksRenderer
        blocks={[
          row("proof_grid", {
            heading: "Outcomes",
            items: [{ label: "x", outcome: XSS }],
          }),
        ]}
      />,
    );
    expect(html).not.toMatch(/<script[\s>]/i);
  });

  it("service_grid block escapes <script> in body", () => {
    const html = renderToString(
      <BlocksRenderer
        blocks={[
          row("service_grid", {
            heading: "Services",
            services: [
              { name: "x", body: XSS, deliverable: "tag" },
            ],
          }),
        ]}
      />,
    );
    expect(html).not.toMatch(/<script[\s>]/i);
  });
});
