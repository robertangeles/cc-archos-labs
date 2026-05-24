import "server-only";
import { findSimilarPosts } from "../posts/find-similar";

// Admin "Suggest internal links" wraps the shared findSimilarPosts helper
// (lib/posts/find-similar.ts) with admin-specific defaults:
//   - excludePostIds = [excludePostId]  (don't suggest the current post)
//   - visibility = 'any'                 (admin can intentionally link to
//                                          unlisted posts — campaign URLs,
//                                          email-only pieces, etc.)
//
// Used by /api/admin/posts/[id]/suggest-links.
//
// LinkSuggestion is preserved as the public type of this module so the
// existing admin caller's import stays valid; structurally it's the same
// as SimilarPost from the shared helper.

export interface LinkSuggestion {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  categoryName: string | null;
  /** Cosine DISTANCE (0 = identical, 2 = opposite). Lower = more similar. */
  distance: number;
}

export interface SuggestLinksInput {
  /** Post id to exclude from results (the one being edited). */
  excludePostId: string;
  /** Draft text to embed and search against. */
  draftContent: {
    title: string;
    excerpt?: string | null;
    contentMd?: string | null;
  };
  /** How many suggestions to return. Defaults to 5. */
  limit?: number;
}

export async function suggestInternalLinks(
  input: SuggestLinksInput,
): Promise<LinkSuggestion[]> {
  return findSimilarPosts({
    queryText: input.draftContent,
    excludePostIds: [input.excludePostId],
    limit: input.limit,
    visibility: "any",
  });
}
