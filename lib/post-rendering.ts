// Pure helpers used by the post page renderer. No DB, no server-only deps —
// safe to import from client components (TOC drawer, copy-link button).

export interface TocHeading {
  /** 2 or 3 — h2 or h3. h1 (page title) is excluded by convention. */
  level: 2 | 3;
  /** Display text of the heading. */
  text: string;
  /** Anchor slug for hash-link navigation. */
  id: string;
}

/**
 * Extract h2 + h3 headings from a markdown body. Used by the Toc component.
 * Returns headings in source order with anchor slugs that match what
 * ReactMarkdown's rehype-slug-style output would produce (we add the `id`
 * attribute ourselves in the heading renderer overrides).
 *
 * Anchor algorithm: lowercase, ASCII-only, hyphenated, deduplicate by
 * appending `-2`, `-3`, ... to subsequent collisions. Matches GitHub's
 * heading-anchor convention so deep-links survive copy/paste from other
 * markdown contexts.
 */
export function generateToc(markdown: string): TocHeading[] {
  const headings: TocHeading[] = [];
  const seenIds = new Map<string, number>();

  // Strip fenced code blocks before scanning so ``` # not heading``` is ignored.
  const stripped = markdown.replace(/```[\s\S]*?```/g, "");

  const headingRe = /^(#{2,3})\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(stripped)) !== null) {
    const level = m[1].length === 2 ? 2 : 3;
    const rawText = m[2].replace(/[*_`]/g, "").trim();
    if (!rawText) continue;
    const baseSlug = slugifyHeading(rawText);
    const count = seenIds.get(baseSlug) ?? 0;
    const id = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
    seenIds.set(baseSlug, count + 1);
    headings.push({ level: level as 2 | 3, text: rawText, id });
  }
  return headings;
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Display string for the "Last reviewed" micro-row. Falls back to
 * published date if last_reviewed_at is null (which can happen for
 * directly-authored posts that haven't been reviewed yet).
 *
 * Format: "Mar 2026" — month + year only. Day-level granularity reads
 * as bureaucratic for evergreen editorial content.
 */
export function formatLastReviewed(
  lastReviewedAt: Date | null,
  publishedAt: Date,
): string {
  const d = lastReviewedAt ?? publishedAt;
  return d.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

/**
 * Display string for the published date. Used in /blog index rows and
 * post-header byline.
 */
export function formatPublishedDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Truncate a string at a word boundary, appending an ellipsis when the
 * truncation actually happens. Default 160 matches the WordPress
 * "Excerpt" convention + the Google SERP meta-description cutoff.
 * Idempotent on inputs already at-or-below the limit.
 */
export function truncateExcerpt(text: string, maxLength = 160): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  // Cut at the last whitespace so we never break a word mid-character.
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  // Strip trailing punctuation so "word, …" reads cleaner than "word,…".
  return cut.replace(/[,;:.\-—]+$/, "") + "…";
}
