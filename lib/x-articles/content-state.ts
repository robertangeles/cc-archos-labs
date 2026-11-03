import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

// Markdown -> X Article `content_state` (DraftJS shape, snake_case on the wire).
// Pure and fail-closed: only the node types handled below are converted, so a
// post using anything else is refused, never posted as lossy plain text.
// Offsets are UTF-16 code units (plain JS string indices), as DraftJS uses.

type BlockType =
  | "unstyled"
  | "header-one"
  | "header-two"
  | "header-three"
  | "unordered-list-item"
  | "ordered-list-item"
  | "blockquote"
  | "atomic";

type InlineStyle = "bold" | "italic" | "strikethrough";

export type Block = {
  text: string;
  type: BlockType;
  inline_style_ranges?: { offset: number; length: number; style: InlineStyle }[];
  entity_ranges?: { key: number; offset: number; length: number }[];
};

export type EntityEntry = {
  key: string;
  value: {
    type: "link" | "divider";
    mutability: "mutable" | "immutable";
    data: { url?: string };
  };
};

export type ContentState = { blocks: Block[]; entities: EntityEntry[] };

// Block types sent as themselves. X answers a bare 503 to a body with header-three,
// bullets, numbered items or a quote (live spike 2026-11-03) and the culprit is not
// isolated yet, so each of those is written with proven blocks (see textBlock).
// Add a type here once X is known to accept it.
export const NATIVE_BLOCK_TYPES: ReadonlySet<Block["type"]> = new Set<Block["type"]>([
  "unstyled",
  "header-two",
  "atomic",
]);

export type ConvertResult =
  | { ok: true; contentState: ContentState }
  | {
      ok: false;
      reason: "empty_body" | "unsupported_markup" | "invalid_link";
      detail: string;
    };

type Failure = Extract<ConvertResult, { ok: false }>;
type MdNode = ReturnType<typeof fromMarkdown>["children"][number];
type Ctx = { siteUrl: string; entities: EntityEntry[]; native: ReadonlySet<Block["type"]> };
type Acc = {
  text: string;
  styles: NonNullable<Block["inline_style_ranges"]>;
  links: NonNullable<Block["entity_ranges"]>;
};

class Refusal extends Error {
  failure: Failure;
  constructor(reason: Failure["reason"], detail: string) {
    super(detail);
    this.failure = { ok: false, reason, detail };
  }
}

function refuse(reason: Failure["reason"], detail: string): never {
  throw new Refusal(reason, detail);
}

const STYLE = { strong: "bold", emphasis: "italic", delete: "strikethrough" } as const;
const HEADER = { 1: "header-one", 2: "header-two", 3: "header-three" } as const;
const FALLBACK_TYPE: Partial<Record<BlockType, BlockType>> = {
  "header-one": "header-two",
  "header-three": "header-two",
  "unordered-list-item": "unstyled",
  "ordered-list-item": "unstyled",
  blockquote: "unstyled",
};
// Control characters except tab, LF and CR (markdown needs those). Stripped before
// parsing because micromark would turn a NUL into U+FFFD.
 
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Only absolute http(s) URLs may become link entities. The error detail names
// the scheme or the reason, never the URL itself.
function safeUrl(raw: string, siteUrl: string): string {
  if (raw.startsWith("//")) refuse("invalid_link", "protocol-relative");
  if (raw.startsWith("#")) refuse("invalid_link", "fragment");
  const absolute = raw.startsWith("/") ? siteUrl.replace(/\/+$/, "") + raw : raw;
  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return refuse("invalid_link", "malformed");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    refuse("invalid_link", url.protocol.slice(0, -1));
  }
  return url.href;
}

function addEntity(ctx: Ctx, value: EntityEntry["value"]): number {
  ctx.entities.push({ key: String(ctx.entities.length), value });
  return ctx.entities.length - 1;
}

function inline(node: MdNode, acc: Acc, ctx: Ctx): void {
  const start = acc.text.length;
  switch (node.type) {
    case "text":
      // A soft line break (or tab) must not glue two words together.
      acc.text += node.value.replace(/\r?\n|\t/g, " ");
      return;
    case "strong":
    case "emphasis":
    case "delete": {
      for (const child of node.children) inline(child, acc, ctx);
      const length = acc.text.length - start;
      if (length) acc.styles.push({ offset: start, length, style: STYLE[node.type] });
      return;
    }
    case "link": {
      // GFM turns a bare email address into a mailto link the author never wrote.
      // Keep the address as plain text; a deliberate [text](mailto:...) is still refused.
      const only = node.children[0];
      if (
        node.url.startsWith("mailto:") &&
        node.children.length === 1 &&
        only.type === "text" &&
        only.value === node.url.slice("mailto:".length)
      ) {
        acc.text += only.value;
        return;
      }
      const url = safeUrl(node.url, ctx.siteUrl);
      for (const child of node.children) inline(child, acc, ctx);
      const length = acc.text.length - start;
      if (length) {
        const key = addEntity(ctx, { type: "link", mutability: "mutable", data: { url } });
        acc.links.push({ key, offset: start, length });
      }
      return;
    }
    default:
      refuse("unsupported_markup", node.type);
  }
}

// A type outside ctx.native is written with proven blocks: bullets and numbers as a
// text prefix (ranges move past it), a quote as italic text, h1 and h3 as header-two.
function textBlock(type: BlockType, children: MdNode[], ctx: Ctx, ordinal = 0): Block {
  const acc: Acc = { text: "", styles: [], links: [] };
  for (const child of children) inline(child, acc, ctx);
  const native = ctx.native.has(type);
  const prefix = native
    ? ""
    : type === "unordered-list-item"
      ? "\u2022 "
      : type === "ordered-list-item"
        ? `${ordinal}. `
        : "";
  const shift = <T extends { offset: number }>(r: T) => ({ ...r, offset: r.offset + prefix.length });
  const text = prefix + acc.text;
  let styles = acc.styles.map(shift);
  if (!native && type === "blockquote" && text) {
    // One italic range over the whole text; italics inside it would only overlap.
    styles = [
      { offset: 0, length: text.length, style: "italic" },
      ...styles.filter((r) => r.style !== "italic"),
    ];
  }
  const block: Block = { text, type: native ? type : (FALLBACK_TYPE[type] ?? type) };
  if (styles.length) block.inline_style_ranges = styles;
  if (acc.links.length) block.entity_ranges = acc.links.map(shift);
  return block;
}

function dividerBlock(ctx: Ctx): Block {
  const key = addEntity(ctx, { type: "divider", mutability: "immutable", data: {} });
  return { text: " ", type: "atomic", entity_ranges: [{ key, offset: 0, length: 1 }] };
}

function convertNode(node: MdNode, ctx: Ctx, out: Block[]): void {
  switch (node.type) {
    case "paragraph":
      out.push(textBlock("unstyled", node.children, ctx));
      return;
    case "heading":
      if (node.depth > 3) refuse("unsupported_markup", node.type);
      out.push(textBlock(HEADER[node.depth as 1 | 2 | 3], node.children, ctx));
      return;
    case "list":
      for (const [i, item] of node.children.entries()) {
        const [only] = item.children;
        if (item.checked != null || item.children.length !== 1 || only.type !== "paragraph") {
          refuse(
            "unsupported_markup",
            item.children.find((c) => c.type !== "paragraph")?.type ?? item.type,
          );
        }
        out.push(
          textBlock(
            node.ordered ? "ordered-list-item" : "unordered-list-item",
            only.children,
            ctx,
            (node.start ?? 1) + i,
          ),
        );
      }
      return;
    case "blockquote": {
      // 100 of 346 migrated posts open with their hook line as `> ## heading`
      // (a WordPress pull-quote). The source treats it as the headline, so it
      // becomes a header block; any other heading inside a quote is still refused.
      const [only] = node.children;
      if (node.children.length === 1 && only.type === "heading") {
        convertNode(only, ctx, out);
        return;
      }
      for (const child of node.children) {
        if (child.type !== "paragraph") refuse("unsupported_markup", child.type);
        out.push(textBlock("blockquote", child.children, ctx));
      }
      return;
    }
    case "thematicBreak":
      out.push(dividerBlock(ctx));
      return;
    default:
      refuse("unsupported_markup", node.type);
  }
}

export function markdownToContentState(input: {
  contentMd: string;
  siteUrl: string;
  byline?: string | null;
  backlink?: { url: string } | null;
  nativeBlocks?: ReadonlySet<Block["type"]>;
}): ConvertResult {
  const markdown = input.contentMd.replace(CONTROL, "");
  if (!markdown.trim()) {
    return { ok: false, reason: "empty_body", detail: "body is empty" };
  }
  const ctx: Ctx = {
    siteUrl: input.siteUrl,
    entities: [],
    native: input.nativeBlocks ?? NATIVE_BLOCK_TYPES,
  };
  const blocks: Block[] = [];
  try {
    const tree = fromMarkdown(markdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    for (const node of tree.children) convertNode(node, ctx, blocks);

    if (input.byline?.trim()) blocks.push({ text: input.byline, type: "unstyled" });
    if (input.backlink) {
      const url = safeUrl(input.backlink.url, input.siteUrl);
      const lead = "Originally published at ";
      const divider = dividerBlock(ctx);
      const key = addEntity(ctx, { type: "link", mutability: "mutable", data: { url } });
      blocks.push(divider, {
        text: lead + url,
        type: "unstyled",
        entity_ranges: [{ key, offset: lead.length, length: url.length }],
      });
    }
  } catch (err) {
    if (err instanceof Refusal) return err.failure;
    throw err;
  }
  return { ok: true, contentState: { blocks, entities: ctx.entities } };
}
