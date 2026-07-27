// Alt-text length policy, in one place.
//
// 125 characters is the accessibility convention: screen readers announce alt
// text as a single unbroken utterance, and past roughly this length listeners
// lose the thread. The limit is NOT the problem — how we hit it was.
//
// Both writers used a bare `.slice(0, 125)`, which cuts mid-word. Live example
// from a published post:
//
//   "Figure in empty gate lounge at night, facing glass wall. Two identical
//    jet bridges suspended above ground, their shadows cast"
//
// That string is also og:image:alt, so the truncation is what Facebook and
// LinkedIn read out and what a screen-reader user hears. Cutting at the last
// word boundary instead costs a few characters and reads as a finished phrase.
//
// The 125 in lib/posts-admin/schema.ts is deliberately NOT this helper: that
// is a Zod `.max()` on human-entered admin input, where the right behaviour is
// to REJECT with a message rather than silently shorten what someone typed.
// This helper is for machine-generated alt text, where there is no one to tell.

/** Max characters in persisted alt text. Accessibility convention, not a DB limit. */
export const ALT_MAX_LEN = 125;

/**
 * Trim alt text to `ALT_MAX_LEN`, cutting at a word boundary.
 *
 * Falls back to a hard slice when the first token alone exceeds the limit —
 * there is no boundary to cut at, and a truncated word beats no alt at all.
 * Trailing separators left dangling by the cut are removed so the result does
 * not end on a comma or dash.
 */
export function trimAltToWordBoundary(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= ALT_MAX_LEN) return trimmed;

  const window = trimmed.slice(0, ALT_MAX_LEN);
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace <= 0) return window;

  return window.slice(0, lastSpace).replace(/[\s.,;:—-]+$/, "");
}
