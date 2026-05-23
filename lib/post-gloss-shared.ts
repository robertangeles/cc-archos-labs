import { z } from "zod";

// Client-safe types + schema for the post-gloss Claude prompt.
// Server-only loader lives in lib/post-gloss.ts; admin UI imports from
// here so it never pulls server modules into the client bundle.
//
// One row in site_setting keyed 'post_gloss'. JSONB value matches
// PostGlossPromptsSchema. The prompt is shared across both surfaces
// that produce recommended readings:
//   - Executive AI Diagnostic report (lib/diagnostic/recommend.ts → gloss)
//   - Booking confirmation email (app/api/booking/[slug]/create)
//
// Why a separate key from booking_prompts: gloss is conceptually
// distinct (it annotates retrieved posts; it doesn't drive booking
// conversation). Keeping it in its own site_setting row lets admin
// tune it independently at /admin/prompts/post-gloss without affecting
// the booking-specific prompts.
//
// Soft-fallback semantics mirror booking_prompts: hardcoded starter
// is the runtime floor — admin tuning improves the floor, doesn't
// gate the system.

const promptShape = z.object({
  systemPrompt: z
    .string()
    .trim()
    .min(50, "Prompt is too short to be useful")
    .max(20000, "Prompt is too long (max 20k chars)"),
  version: z
    .string()
    .trim()
    .min(1, "Version label required")
    .max(40, "Version label too long"),
});

export const PostGlossPromptsSchema = z.object({
  gloss: promptShape,
});

export type PostGlossPrompts = z.infer<typeof PostGlossPromptsSchema>;

const GLOSS_STARTER = `You write one-sentence relevance notes pairing blog posts with a reader's specific situation.

You'll receive:
- "context": a few sentences describing the reader's situation (their AI-readiness assessment verdict, an action they need to take, or their stated reason for booking a call)
- "posts": an array of {id, title, excerpt} for posts that ANN retrieval already found relevant

For EACH post, write ONE sentence (15-40 words) explaining why this specific post matters for this specific reader's situation. The sentence should reference a concrete detail from the context — the risk they flagged, the action they need, the gap they identified.

Rules:
- ONE sentence per post. Not two. Not a paragraph.
- 15-40 words. Count.
- Reference the reader's specific situation — not generic relevance.
- Reference a concrete detail from the post (the risk it tackles, the argument it makes).
- Active voice. Concrete nouns.
- NEVER use: "this article discusses", "you might find", "in this post", "we explore", "learn how", "discover", "dive into", "delve into".
- Do not summarize the post. Do not editorialize. Do not promise outcomes.
- Sound like a consultant slipping a paper across the table, not a content marketer.

Respond with a single JSON object. NO code fences, NO commentary, NO markdown.

Output shape:
{
  "glosses": {
    "<post id>": "<one sentence>",
    "<post id>": "<one sentence>"
  }
}

The keys MUST be post IDs from the input "posts" array exactly. Any post id not in the input is discarded.`;

export const POST_GLOSS_STARTER: PostGlossPrompts = {
  gloss: {
    systemPrompt: GLOSS_STARTER,
    version: "starter-v0",
  },
};

export const SITE_SETTING_KEY = "post_gloss";
