// transform.ts — pure functions: WP HTML → markdown via Turndown,
// slug normalisation, reading-time + word-count helpers.
//
// Per the 2026-05-19 inventory, the source content is Gutenberg-only
// (zero shortcodes). That keeps this module simple: Turndown with the
// GFM plugin handles 99% of the cases natively. A few light custom
// rules handle Gutenberg-specific HTML patterns (figure+figcaption,
// empty <p>&nbsp;</p>, wp-block-* wrapper divs).
//
// Pure functions: no I/O, no DB, no fs. Easy to unit-test with fixtures.

import TurndownService from "turndown";
// turndown-plugin-gfm doesn't ship types — declare module via the local
// types/turndown-plugin-gfm.d.ts shim.
// @ts-expect-error — no types
import { gfm } from "turndown-plugin-gfm";
import type { ExtractedPost, TransformedPost } from "./types";

// =============================================================================
// Turndown configuration
// =============================================================================

function buildTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx", // # H1 style (vs Setext)
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced", // ``` blocks (vs indented)
    fence: "```",
    emDelimiter: "_",
    strongDelimiter: "**",
    linkStyle: "inlined", // [text](url) inline (vs [text][ref])
    linkReferenceStyle: "full",
  });

  td.use(gfm); // tables, strikethrough, task lists

  // Strip Gutenberg's empty paragraph spacers. These appear as
  // <p>&nbsp;</p> or <p></p> and round-trip to "&nbsp;" or empty
  // markdown paragraphs that mess up spacing.
  td.addRule("strip-empty-p", {
    filter: (node) =>
      node.nodeName === "P" &&
      (node.textContent ?? "").replace(/ |\s/g, "") === "",
    replacement: () => "",
  });

  // <figure><img …><figcaption>…</figcaption></figure>
  // Gutenberg's standard image block. Turndown's default treats this
  // as a div with an image inside; we want the caption to render as
  // italicised text on a new line after the image (mirrors how the
  // existing MarkdownArticle renderer handles it).
  //
  // We walk childNodes manually rather than calling querySelector
  // because Turndown's runtime DOM (domino) doesn't expose
  // querySelector consistently across versions.
  td.addRule("figure-with-caption", {
    filter: (node) => node.nodeName === "FIGURE",
    replacement: (_content, node) => {
      let img: Element | null = null;
      let caption: Element | null = null;
      const el = node as Element;
      for (const child of Array.from(el.childNodes)) {
        const name = child.nodeName;
        if (name === "IMG") img = child as Element;
        else if (name === "FIGCAPTION") caption = child as Element;
        else if (name === "DIV" || name === "SPAN") {
          // wp-block-image sometimes wraps the img in an inner div
          for (const inner of Array.from((child as Element).childNodes)) {
            if (inner.nodeName === "IMG") img = inner as Element;
            else if (inner.nodeName === "FIGCAPTION") {
              caption = inner as Element;
            }
          }
        }
      }
      if (!img) return _content; // no image — fall through to default
      const src = img.getAttribute("src") ?? "";
      const alt = img.getAttribute("alt") ?? "";
      const captionText = (caption?.textContent ?? "").trim();
      const imageLine = `![${alt}](${src})`;
      if (captionText) {
        return `\n\n${imageLine}\n\n_${captionText}_\n\n`;
      }
      return `\n\n${imageLine}\n\n`;
    },
  });

  // Strip Gutenberg block wrapper divs (wp-block-*) — preserve their
  // children, drop the wrapper. Turndown by default would skip the
  // div entirely; we override to keep inner content.
  td.addRule("wp-block-wrapper", {
    filter: (node) => {
      if (node.nodeName !== "DIV") return false;
      const cls = (node as HTMLElement).className || "";
      return /wp-block-/.test(cls);
    },
    replacement: (content) => content,
  });

  return td;
}

const td = buildTurndown();

// =============================================================================
// Public API
// =============================================================================

/**
 * Convert raw WP HTML to markdown. Idempotent: passing the same input
 * always returns the same output.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  const md = td.turndown(html);
  return normaliseWhitespace(md);
}

/**
 * Collapse runs of blank lines to a single blank line, trim trailing
 * whitespace per line, trim leading/trailing newlines. Stable across runs.
 */
export function normaliseWhitespace(md: string): string {
  return md
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Slug normalisation. WP `post_name` is already kebab-case URL-safe
 * (we verified in the inventory) so this is largely defensive: lowercase,
 * strip non-alphanumeric except hyphen, collapse multiple hyphens.
 *
 * Used as a fallback if a WP slug is somehow malformed; not normally invoked.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 200);
}

/**
 * Count words. Used to compute reading_time_min and word_count fields on
 * the post row. Simple whitespace split — close enough for editorial
 * content (no CJK-specific tokenisation needed).
 */
export function countWords(md: string): number {
  if (!md.trim()) return 0;
  return md.trim().split(/\s+/).length;
}

/**
 * Reading time in minutes, rounded UP. Standard 200 wpm convention used
 * by Medium / Substack. Minimum 1 minute (never display "0 min read").
 */
export function getReadingTime(md: string): number {
  const words = countWords(md);
  if (words === 0) return 1;
  return Math.max(1, Math.ceil(words / 200));
}

/**
 * Apply transform stage to an ExtractedPost. Pure: no I/O.
 */
export function transformPost(post: ExtractedPost): TransformedPost {
  const contentMd = htmlToMarkdown(post.rawHtml);
  const wordCount = countWords(contentMd);
  const readingTimeMin = getReadingTime(contentMd);
  return {
    ...post,
    contentMd,
    wordCount,
    readingTimeMin,
  };
}
