import { describe, expect, it } from "vitest";
import { markdownToContentState, type ContentState } from "./content-state";

const SITE = "https://archoslabs.xyz";

type Extra = { byline?: string | null; backlink?: { url: string } | null };

function ok(contentMd: string, extra: Extra = {}): ContentState {
  const r = markdownToContentState({ contentMd, siteUrl: SITE, ...extra });
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.detail}`);
  return r.contentState;
}

function refused(contentMd: string, extra: Extra = {}, siteUrl = SITE) {
  const r = markdownToContentState({ contentMd, siteUrl, ...extra });
  if (r.ok) throw new Error("expected a refusal");
  return { reason: r.reason, detail: r.detail };
}

describe("allowed nodes", () => {
  it("converts a paragraph to an unstyled block", () => {
    expect(ok("Hello world.")).toEqual({
      blocks: [{ text: "Hello world.", type: "unstyled" }],
      entities: [],
    });
  });

  it.each([
    ["#", "header-one"],
    ["##", "header-two"],
    ["###", "header-three"],
  ])("converts %s headings to %s", (hashes, type) => {
    expect(ok(`${hashes} Title`).blocks).toEqual([{ text: "Title", type }]);
  });

  it("converts bold, italic and strikethrough to inline style ranges", () => {
    expect(ok("a **b** *c* ~~d~~").blocks).toEqual([
      {
        text: "a b c d",
        type: "unstyled",
        inline_style_ranges: [
          { offset: 2, length: 1, style: "bold" },
          { offset: 4, length: 1, style: "italic" },
          { offset: 6, length: 1, style: "strikethrough" },
        ],
      },
    ]);
  });

  it("turns a soft line break into a single space", () => {
    expect(ok("line one\nline two\r\nline three").blocks).toEqual([
      { text: "line one line two line three", type: "unstyled" },
    ]);
  });

  it("converts flat unordered and ordered lists, one block per item", () => {
    expect(ok("- one\n- **two**\n\n1. a\n2. b").blocks).toEqual([
      { text: "one", type: "unordered-list-item" },
      {
        text: "two",
        type: "unordered-list-item",
        inline_style_ranges: [{ offset: 0, length: 3, style: "bold" }],
      },
      { text: "a", type: "ordered-list-item" },
      { text: "b", type: "ordered-list-item" },
    ]);
  });

  it("converts a multi-paragraph blockquote to one blockquote block per paragraph", () => {
    expect(ok("> first\n>\n> second *b*").blocks).toEqual([
      { text: "first", type: "blockquote" },
      {
        text: "second b",
        type: "blockquote",
        inline_style_ranges: [{ offset: 7, length: 1, style: "italic" }],
      },
    ]);
  });

  it("converts a blockquote holding only one heading (the migrated hook line) to a header block", () => {
    expect(ok("> ## You’re not falling behind\n\nBody.").blocks).toEqual([
      { text: "You’re not falling behind", type: "header-two" },
      { text: "Body.", type: "unstyled" },
    ]);
  });

  it("converts a thematic break to an atomic block with a divider entity", () => {
    expect(ok("a\n\n---\n\nb")).toEqual({
      blocks: [
        { text: "a", type: "unstyled" },
        { text: " ", type: "atomic", entity_ranges: [{ key: 0, offset: 0, length: 1 }] },
        { text: "b", type: "unstyled" },
      ],
      entities: [{ key: "0", value: { type: "divider", mutability: "immutable", data: {} } }],
    });
  });

  it("turns a link into a mutable link entity with a range over the link text", () => {
    expect(ok("see [the post](https://example.com/a) now")).toEqual({
      blocks: [
        {
          text: "see the post now",
          type: "unstyled",
          entity_ranges: [{ key: 0, offset: 4, length: 8 }],
        },
      ],
      entities: [
        {
          key: "0",
          value: { type: "link", mutability: "mutable", data: { url: "https://example.com/a" } },
        },
      ],
    });
  });

  it("links bare URLs (GFM autolink literals), as the site does", () => {
    const { blocks, entities } = ok("see https://example.com/a for more");
    expect(blocks[0].entity_ranges).toEqual([{ key: 0, offset: 4, length: 21 }]);
    expect(entities[0].value.data.url).toBe("https://example.com/a");
  });

  it("strips control characters but keeps text around them", () => {
    expect(ok("a\u0000b\u0007c\td").blocks).toEqual([{ text: "abc d", type: "unstyled" }]);
  });
});

describe("UTF-16 offsets", () => {
  it("counts an emoji as two units and CJK as one, before a bold span", () => {
    const [block] = ok("😀 日本語 **bold** end").blocks;
    expect(block.text).toBe("😀 日本語 bold end");
    // 😀 = 2 units, space = 1, 日本語 = 3, space = 1
    expect(block.inline_style_ranges).toEqual([{ offset: 7, length: 4, style: "bold" }]);
    const { offset, length } = block.inline_style_ranges![0];
    expect(block.text.slice(offset, offset + length)).toBe("bold");
  });

  it("counts emoji inside the styled span and CJK before a link", () => {
    const { blocks } = ok("日本語😀 [リンク😀](https://example.com/) **x😀**");
    const [block] = blocks;
    const link = block.entity_ranges![0];
    expect(link).toEqual({ key: 0, offset: 6, length: 5 });
    expect(block.text.slice(link.offset, link.offset + link.length)).toBe("リンク😀");
    const bold = block.inline_style_ranges![0];
    expect(bold).toEqual({ offset: 12, length: 3, style: "bold" });
    expect(block.text.slice(bold.offset, bold.offset + bold.length)).toBe("x😀");
  });
});

describe("links", () => {
  it.each([
    ["https://archoslabs.xyz"],
    ["https://archoslabs.xyz/"],
    ["https://archoslabs.xyz//"],
  ])("absolutises a relative link against %s", (siteUrl) => {
    const r = markdownToContentState({
      contentMd: "[post](/blog/x?y=1#z)",
      siteUrl,
    });
    expect(r.ok && r.contentState.entities[0].value.data.url).toBe(
      "https://archoslabs.xyz/blog/x?y=1#z",
    );
  });

  it.each([
    ["javascript:alert(1)", "javascript"],
    ["data:text/html;base64,AAAA", "data"],
    ["mailto:someone@example.com", "mailto"],
    ["ftp://example.com/file", "ftp"],
    ["//evil.example/x", "protocol-relative"],
    ["#section", "fragment"],
    ["not-a-url", "malformed"],
    ["http://", "malformed"],
  ])("refuses link %s", (url, detail) => {
    const r = refused(`[click](${url})`);
    expect(r).toEqual({ reason: "invalid_link", detail });
    expect(r.detail).not.toContain("alert");
    expect(r.detail).not.toContain("evil");
  });

  it("refuses an angle-bracket autolink with a bad scheme", () => {
    expect(refused("<javascript:alert(1)>")).toEqual({
      reason: "invalid_link",
      detail: "javascript",
    });
  });

  it("keeps a bare email address as plain text (GFM turns it into a mailto link the author never wrote)", () => {
    expect(ok("write to someone@example.com today").blocks).toEqual([
      { text: "write to someone@example.com today", type: "unstyled" },
    ]);
    expect(ok("write to someone@example.com today").entities).toEqual([]);
  });

  it("still refuses a deliberate mailto link, even one that shows the address", () => {
    expect(refused("[mail me](mailto:someone@example.com)")).toEqual({
      reason: "invalid_link",
      detail: "mailto",
    });
    expect(refused("[other@example.com](mailto:someone@example.com)")).toEqual({
      reason: "invalid_link",
      detail: "mailto",
    });
  });

  it("puts the bold range and the link range correctly for bold inside a link", () => {
    expect(ok("[**bold** text](https://a.example/)").blocks).toEqual([
      {
        text: "bold text",
        type: "unstyled",
        inline_style_ranges: [{ offset: 0, length: 4, style: "bold" }],
        entity_ranges: [{ key: 0, offset: 0, length: 9 }],
      },
    ]);
  });

  it("puts the bold range and the link range correctly for a link inside bold", () => {
    expect(ok("**see [link](https://a.example/) now**").blocks).toEqual([
      {
        text: "see link now",
        type: "unstyled",
        inline_style_ranges: [{ offset: 0, length: 12, style: "bold" }],
        entity_ranges: [{ key: 0, offset: 4, length: 4 }],
      },
    ]);
  });

  it("gives each link its own entity, keyed by its index", () => {
    const { blocks, entities } = ok("[a](https://a.example/) and [b](https://b.example/)");
    expect(blocks[0].entity_ranges).toEqual([
      { key: 0, offset: 0, length: 1 },
      { key: 1, offset: 6, length: 1 },
    ]);
    expect(entities.map((e) => e.key)).toEqual(["0", "1"]);
  });
});

describe("refusals (fail closed)", () => {
  it.each([
    ["GFM pipe table", "| a | b |\n|---|---|\n| 1 | 2 |", "table"],
    ["fenced code", "```\ncode\n```", "code"],
    ["indented code", "    code", "code"],
    ["inline code", "use `npm` here", "inlineCode"],
    ["image", "![alt](https://example.com/i.png)", "image"],
    ["block html", "<div>x</div>", "html"],
    ["inline html", "a <b>x</b> c", "html"],
    ["footnote reference", "text[^1]\n\n[^1]: note", "footnoteReference"],
    ["footnote definition", "[^1]: note", "footnoteDefinition"],
    ["definition", "[a]: https://example.com/", "definition"],
    ["link reference", "[a][b]\n\n[b]: https://example.com/", "linkReference"],
    ["image reference", "![a][b]\n\n[b]: https://example.com/i.png", "imageReference"],
    ["hard line break", "a  \nb", "break"],
    ["heading depth 4", "#### Deep", "heading"],
    ["heading depth 6", "###### Deeper", "heading"],
    ["nested list", "- a\n  - b", "list"],
    ["list item with two paragraphs", "- a\n\n  b", "listItem"],
    ["list item with code", "- a\n\n  ```\n  x\n  ```", "code"],
    ["task list item", "- [ ] todo", "listItem"],
    ["blockquote with list", "> - a", "list"],
    ["blockquote with a heading and a paragraph", "> ## h\n>\n> text", "heading"],
    ["blockquote with a depth-4 heading", "> #### h", "heading"],
    ["nested blockquote", "> > deep", "blockquote"],
  ])("refuses %s", (_name, md, detail) => {
    expect(refused(md)).toEqual({ reason: "unsupported_markup", detail });
  });

  it("reports the first refusal in document order and ignores later problems", () => {
    expect(refused("fine\n\n`code`\n\n[x](javascript:1)")).toEqual({
      reason: "unsupported_markup",
      detail: "inlineCode",
    });
  });

  it.each([[""], ["   \n\n\t "], ["\u0000\u0007"]])("refuses an empty body %j", (md) => {
    expect(refused(md).reason).toBe("empty_body");
  });
});

describe("trailer", () => {
  const backlink = { url: "https://archoslabs.xyz/blog/x?utm_source=x&utm_medium=article" };

  it("adds nothing without a byline or backlink", () => {
    expect(ok("body", { byline: null, backlink: null }).blocks).toHaveLength(1);
    expect(ok("body", { byline: "  " }).blocks).toHaveLength(1);
  });

  it("adds the byline as a plain unstyled paragraph with exactly that text", () => {
    expect(ok("body", { byline: "By Rob, Archos Labs" }).blocks).toEqual([
      { text: "body", type: "unstyled" },
      { text: "By Rob, Archos Labs", type: "unstyled" },
    ]);
  });

  it("adds a divider and an 'Originally published at' paragraph linking the URL", () => {
    const lead = "Originally published at ";
    expect(ok("body", { backlink })).toEqual({
      blocks: [
        { text: "body", type: "unstyled" },
        { text: " ", type: "atomic", entity_ranges: [{ key: 0, offset: 0, length: 1 }] },
        {
          text: lead + backlink.url,
          type: "unstyled",
          entity_ranges: [{ key: 1, offset: lead.length, length: backlink.url.length }],
        },
      ],
      entities: [
        { key: "0", value: { type: "divider", mutability: "immutable", data: {} } },
        { key: "1", value: { type: "link", mutability: "mutable", data: { url: backlink.url } } },
      ],
    });
  });

  it("orders byline, divider, backlink after body links with sequential entity keys", () => {
    const { blocks, entities } = ok("[a](https://a.example/)", { byline: "By Rob", backlink });
    expect(blocks.map((b) => b.type)).toEqual(["unstyled", "unstyled", "atomic", "unstyled"]);
    expect(blocks[1].text).toBe("By Rob");
    expect(entities.map((e) => `${e.key}:${e.value.type}`)).toEqual(["0:link", "1:divider", "2:link"]);
    expect(blocks[3].entity_ranges![0].key).toBe(2);
  });

  it.each([
    ["javascript:alert(1)", "javascript"],
    ["//evil.example/x", "protocol-relative"],
  ])("refuses a bad backlink %s", (url, detail) => {
    expect(refused("body", { backlink: { url } })).toEqual({ reason: "invalid_link", detail });
  });
});

describe("a realistic post", () => {
  const md = [
    "Most data programs fail in the **second** year, not the first. Here is what the budget review never asks.",
    "",
    "## What the headline left out",
    "",
    "The vendor's [press release](https://example.com/news/launch) says 40% faster. The [benchmark](/blog/benchmarks) says otherwise:",
    "",
    "- Cold start is *slower*, not faster",
    "- The 40% figure is a p50 on a warm cache",
    "",
    "> If the number only works warm, it is a marketing number.",
    "",
    "---",
    "",
    "Verdict: read the primary source before you repeat the claim.",
  ].join("\n");

  it("converts end to end with consistent offsets", () => {
    const { blocks, entities } = ok(md, { byline: "By Rob Angeles" });
    expect(blocks.map((b) => b.type)).toEqual([
      "unstyled",
      "header-two",
      "unstyled",
      "unordered-list-item",
      "unordered-list-item",
      "blockquote",
      "atomic",
      "unstyled",
      "unstyled",
    ]);
    // Every range must point at the text it claims, inside the block.
    for (const b of blocks) {
      for (const r of b.entity_ranges ?? []) {
        expect(r.offset + r.length).toBeLessThanOrEqual(b.text.length);
        expect(entities[r.key].key).toBe(String(r.key));
      }
      for (const r of b.inline_style_ranges ?? []) {
        expect(r.offset + r.length).toBeLessThanOrEqual(b.text.length);
      }
    }
    const para = blocks[2];
    const [first, second] = para.entity_ranges!;
    expect(para.text.slice(first.offset, first.offset + first.length)).toBe("press release");
    expect(para.text.slice(second.offset, second.offset + second.length)).toBe("benchmark");
    expect(entities.map((e) => e.value.data.url).filter(Boolean)).toEqual([
      "https://example.com/news/launch",
      "https://archoslabs.xyz/blog/benchmarks",
    ]);
    expect(blocks[3].inline_style_ranges).toEqual([{ offset: 14, length: 6, style: "italic" }]);
  });
});
