// Pure cursor-resolution + insertion builder for the post-editor's
// "Insert link" affordance. Extracted from post-form.tsx so the
// regression case (no prior focus → invisible insertion at position 0)
// can be unit-tested without spinning up React + JSDOM.
//
// See wiki/synthesis/2026-05-24-blog-tidy-ceo-review.md E2 for the
// pre-fix diagnosis. The fix: three-tier cursor resolution that prefers
// live selection, falls back to a snapshot, and finally defaults to
// END (never to 0).

export type InsertionKind =
  | "wrap_selection"
  | "at_cursor"
  | "at_snapshot"
  | "at_end";

export interface ComputeInsertionArgs {
  /** Current markdown body. */
  contentMd: string;
  /** Markdown to insert — typically `[Title](/blog/slug)`. */
  markdown: string;
  /** True when the textarea is the active element at click time. */
  isLive: boolean;
  /** Live selection start (only meaningful when isLive=true). */
  liveStart: number | null;
  /** Live selection end (only meaningful when isLive=true). */
  liveEnd: number | null;
  /**
   * Snapshot captured on the textarea's last onSelect/onBlur. Used when
   * the textarea has been interacted with but is not currently focused
   * (typical when the user opens the suggestions drawer).
   */
  snapshot: { start: number; end: number } | null;
}

export interface ComputeInsertionResult {
  /** The full new contentMd string after insertion. */
  nextContent: string;
  /** The text that was actually inserted (after selection-wrap handling). */
  insertion: string;
  /** Where the cursor should land after the insertion. */
  cursor: number;
  /** Diagnostic label for telemetry. */
  kind: InsertionKind;
}

/**
 * Compute the result of inserting a markdown link into a textarea,
 * resolving the cursor position via the three-tier fallback described
 * in E2. Pure function — no DOM, no React, no side effects.
 */
export function computeLinkInsertion(
  args: ComputeInsertionArgs,
): ComputeInsertionResult {
  const { contentMd, markdown, isLive, liveStart, liveEnd, snapshot } = args;

  // Three-tier resolution: live selection → snapshot → END.
  // Critical: the final fallback MUST be END, not 0. Returning 0 from
  // an unfocused textarea (the pre-fix behaviour) inserted the link at
  // the top of long articles where it was off-screen — the silent
  // failure the user reported as "Insert link does nothing."
  let start: number;
  let end: number;
  let kind: InsertionKind;

  if (isLive) {
    start = clampToContent(liveStart, contentMd.length);
    end = clampToContent(liveEnd, contentMd.length);
    kind = "at_cursor";
  } else if (snapshot) {
    start = clampToContent(snapshot.start, contentMd.length);
    end = clampToContent(snapshot.end, contentMd.length);
    kind = "at_snapshot";
  } else {
    start = contentMd.length;
    end = contentMd.length;
    kind = "at_end";
  }

  const before = contentMd.slice(0, start);
  const selected = contentMd.slice(start, end);
  const after = contentMd.slice(end);

  // If a range is selected, wrap it: [selected](url) instead of
  // dropping the raw [Title](url). Selection-wrap takes precedence
  // over the kind label.
  let insertion = markdown;
  if (selected) {
    const m = markdown.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (m) insertion = `[${selected}](${m[2]})`;
    kind = "wrap_selection";
  }

  // When appending to a non-empty doc with no prior cursor (kind ===
  // "at_end"), prepend a newline so the link doesn't run into the last
  // paragraph. Doesn't apply to live/snapshot paths — those respect
  // the user's chosen position even if it lands mid-paragraph.
  if (
    kind === "at_end" &&
    contentMd.length > 0 &&
    !contentMd.endsWith("\n")
  ) {
    insertion = "\n" + insertion;
  }

  const nextContent = before + insertion + after;
  const cursor = before.length + insertion.length;

  return { nextContent, insertion, cursor, kind };
}

function clampToContent(
  value: number | null,
  contentLength: number,
): number {
  if (value == null || value < 0) return contentLength;
  if (value > contentLength) return contentLength;
  return value;
}
