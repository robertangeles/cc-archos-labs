// Pure utilities for the post word-count + reading-time pills shown in
// the editor side panel and the published post header. No side effects;
// safe to import from anywhere.
//
// Matches the heuristic the migration script used at backfill time
// (see scripts/migrate-wp/transform.ts) so re-saving an existing post
// in the admin doesn't churn the numbers spuriously.

const WORDS_PER_MINUTE = 220;

/**
 * Word count for a markdown blob. Strips fences + inline backticks +
 * link targets so we count what a reader actually reads, not what's in
 * the source. Whitespace-collapse + split.
 *
 * Empty / whitespace-only input returns 0.
 */
export function computeWordCount(markdown: string): number {
  if (!markdown) return 0;
  const stripped = markdown
    // Fenced code blocks — don't count code as prose.
    .replace(/```[\s\S]*?```/g, "")
    // Inline code.
    .replace(/`[^`]*`/g, "")
    // Image alt-text + link targets: keep the visible label, drop the
    // URL. `![alt](url)` → `alt`, `[label](url)` → `label`.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Markdown formatting markers — *, _, #, >, hyphens at line start.
    .replace(/[*_~>#]+/g, " ")
    .replace(/^[ \t]*[-+]\s+/gm, " ")
    .trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).filter(Boolean).length;
}

/**
 * Reading time in minutes. Minimum 1 (a 2-second skim still gets
 * "1 min read" in the header rather than "0 min").
 */
export function readingTimeMinutes(wordCount: number): number {
  if (wordCount <= 0) return 0;
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}
