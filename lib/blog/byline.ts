// Who gets credited on a blog post, in ONE place.
//
// The byline rendered on the page and the author/editor/contributor fields in
// the Article JSON-LD must agree. If they diverge, Google sees structured data
// that contradicts the visible page — worse than having no structured data at
// all, and the precise failure this feature exists to avoid. So both read this
// predicate rather than each re-deriving the rule.
//
//
// WHY THE PREDICATE IS WHAT IT IS
//
// The claim being made is two separate facts:
//
//   "Researched by Metis"        → Metis actually WROTE the draft
//   "Reviewed by Rob Angeles"    → a human actually READ it
//
// `reviewed_by_human_at` only ever proves the second. It says nothing about
// who wrote the thing. So it cannot be the sole gate: marking one of the ~120
// WordPress-migrated posts as reviewed would render "Researched by Metis" over
// writing Metis never touched.
//
// Authorship cannot come from the author record either. There is exactly one
// row in `author` and scripts/seed/blog-author-backfill.ts renamed it "Metis",
// so post.authorName is "Metis" for the migrated human-written posts AND for
// every agent post. The author table genuinely cannot tell them apart.
//
// `is_agent_generated` is therefore the only trustworthy provenance signal, and
// the gate is the conjunction of the two facts the byline asserts.
//
//
// IF THE AUTHOR MODEL EVER GROWS UP
//
// Read the predicate as "the resolved author is Metis AND a human reviewed it".
// It collapses to `isAgentGenerated` today only because there is a single
// author row. The day real author rows exist and authorship can be reassigned
// independently of provenance — an agent draft handed to a human editor of
// record, say — switch the first term to the resolved author identity
// (personIdForAuthor in lib/schema-graph.ts) so provenance and attribution
// cannot silently drift apart. Until such a reassignment path exists, the two
// are the same fact.
//
// NOT a bug, so do not "fix" it: the single "Metis" author row is a deliberate
// brand decision (confirmed 2026-07-29). One WordPress author existed, the
// migration created one row, and scripts/seed/blog-author-backfill.ts renamed it
// to the public byline. A single Metis voice across the blog is intended.
//
// Which is exactly why this predicate needs `isAgentGenerated` and not the
// author record: the byline is intentionally uniform, so provenance has to come
// from the post.

/** The fields the credit decision depends on. Structural, so both the public
 *  post view and any admin view satisfy it without a cast. */
export interface BylineFacts {
  isAgentGenerated: boolean;
  reviewedByHumanAt: Date | null;
}

/**
 * Can this post truthfully carry "Researched by Metis · Reviewed by Rob"?
 *
 * Requires BOTH that the agent wrote it and that a human signed off. Anything
 * else keeps the existing single-name byline.
 */
export function showsDualByline(post: BylineFacts): boolean {
  return post.isAgentGenerated && post.reviewedByHumanAt !== null;
}
