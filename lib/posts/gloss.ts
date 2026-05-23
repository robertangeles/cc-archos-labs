import "server-only";
import { z } from "zod";
import { generateStructured } from "../claude";
import { getPostGlossPrompts } from "../post-gloss";

// ============================================================================
// Batched gloss generation. ONE Claude call enriches all retrieved posts
// for a single report or booking with a one-sentence relevance note
// tailored to the reader's situation.
//
// Why batched (one call for N posts, not N calls):
//   - 3-5 posts per report × N reports = trivial cost when batched.
//     If we called once per post we'd spend ~5x as much for negligible
//     quality gain — the prompt is the same per post.
//   - Single network roundtrip (~2-3s) instead of N roundtrips.
//
// Degradation contract (the caller WILL hit this in production):
//   - Claude returns malformed JSON  → return {} (no glosses)
//   - Claude returns invalid shape    → return {} (no glosses)
//   - OpenRouter timeout / outage    → return {} (no glosses)
//   - DB prompt row missing/bad      → POST_GLOSS_STARTER (handled in
//                                       lib/post-gloss.ts loader)
//
// Caller behaviour: iterate the posts you sent in, look up each id in
// the returned map; on miss (empty string), render the post WITHOUT
// a gloss subtitle. The readings block still renders — gloss is a
// supplement, not a precondition. (D8 quiet-fail philosophy.)
// ============================================================================

const MAX_TOKENS = 800;
// Truncate excerpts before sending to Claude to keep the userMessage
// bounded. The full post body is not sent — we only need title +
// excerpt for Claude to write a relevance note.
const EXCERPT_TRUNCATE_CHARS = 400;
const CONTEXT_TRUNCATE_CHARS = 2000;

export interface GlossPostInput {
  id: string;
  title: string;
  excerpt: string | null;
}

export interface GeneratePostGlossesInput {
  /**
   * Free text describing the reader's situation. For the diagnostic
   * report: verdict + "\n\n" + narrative + "\n\nActions:\n" + actionPlan
   * titles. For booking: reasonInitial (+ optionally reasonFollowups).
   * Truncated to CONTEXT_TRUNCATE_CHARS before sending to Claude.
   */
  context: string;
  posts: GlossPostInput[];
}

const glossOutputSchema = z.object({
  glosses: z.record(z.string(), z.string()),
});

/**
 * Batched gloss call. Returns a map of postId → one-sentence gloss.
 * Posts in the input that don't appear in the returned map (because
 * Claude omitted them, returned a different id, or hallucinated) get
 * no gloss — caller renders them without the relevance subtitle.
 *
 * Returns {} on ANY error — never throws. The readings block will
 * still render; it just won't have the relevance note layer. This
 * matches the failure contract in the plan's Section 2 error map.
 */
export async function generatePostGlosses(
  input: GeneratePostGlossesInput,
): Promise<Record<string, string>> {
  if (input.posts.length === 0) return {};

  const prompts = await getPostGlossPrompts();
  const validIds = new Set(input.posts.map((p) => p.id));

  const userMessage = JSON.stringify(
    {
      context: input.context.slice(0, CONTEXT_TRUNCATE_CHARS),
      posts: input.posts.map((p) => ({
        id: p.id,
        title: p.title.slice(0, 200),
        excerpt: (p.excerpt ?? "").slice(0, EXCERPT_TRUNCATE_CHARS),
      })),
    },
    null,
    2,
  );

  let raw: unknown;
  try {
    const result = await generateStructured<unknown>({
      systemPrompt: prompts.gloss.systemPrompt,
      userMessage,
      maxTokens: MAX_TOKENS,
    });
    raw = result.data;
  } catch (err) {
    console.warn(
      "[post-gloss] Claude call failed; readings will render without glosses:",
      err instanceof Error ? err.message : err,
    );
    return {};
  }

  const parsed = glossOutputSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      "[post-gloss] Claude returned unexpected shape; readings will render without glosses.",
    );
    return {};
  }

  // Defend against post-id hallucination: only keep entries whose key
  // is a post id we actually sent. Same belt-and-braces pattern as
  // lib/claude-booking.ts#matchBlogPosts.
  const cleaned: Record<string, string> = {};
  for (const [id, gloss] of Object.entries(parsed.data.glosses)) {
    if (!validIds.has(id)) continue;
    if (typeof gloss !== "string") continue;
    const trimmed = gloss.trim();
    if (trimmed.length === 0) continue;
    cleaned[id] = trimmed;
  }
  return cleaned;
}
