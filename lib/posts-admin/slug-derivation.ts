import { randomBytes } from "node:crypto";

// Pure slug-derivation helper for the auto-create-draft path. Extracted
// from createPost so the logic can be unit-tested in isolation (the
// collision-retry loop in index.ts is integration-tested separately
// against the live DB).
//
// Contract:
//   - Normalises the title to ASCII alnum + hyphen, caps the body length
//   - Appends a short random suffix to defend against the concurrent-
//     create race window (two admins typing similar titles in the
//     same second would otherwise collide on the unique slug index)
//   - Falls back to `draft-<8 hex>` when the title doesn't yield 3+
//     usable characters (emoji-only, punctuation-only, very short titles)

const MIN_SLUG_BODY_LEN = 3;
const MAX_SLUG_BODY_LEN = 80;
const SUFFIX_BYTES = 2; // 4 hex chars = 65,536 possibilities
const FALLBACK_BYTES = 4; // 8 hex chars

/**
 * Generate a URL-safe slug from a post title with a short random suffix.
 * Returns `draft-<8 hex>` if the title's normalised body is too short
 * to be a meaningful slug.
 *
 * @param title - The post title; arbitrary UTF-8 accepted
 * @param rng - Optional override for the random-byte generator (test seam)
 */
export function deriveSlugFromTitle(
  title: string,
  rng: (n: number) => Buffer = randomBytes,
): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks (NFKD decomposed accented chars into base
    // + combining mark; the regex drops the marks). Unicode block
    // U+0300–U+036F is the Combining Diacritical Marks range.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_BODY_LEN);

  if (base.length < MIN_SLUG_BODY_LEN) {
    return `draft-${rng(FALLBACK_BYTES).toString("hex")}`;
  }

  const suffix = rng(SUFFIX_BYTES).toString("hex");
  return `${base}-${suffix}`;
}
