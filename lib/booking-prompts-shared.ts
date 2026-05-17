import { z } from "zod";

// Client-safe types + schema for the booking-system Claude prompts.
// Server-only loader lives in lib/booking-prompts.ts; admin UI imports
// from here so it never pulls server modules into the client bundle.
//
// One row in site_setting keyed 'booking_prompts'. JSONB value matches
// BookingPromptsSchema. Three prompts live inside the row:
//   - followup: conversational intake follow-up (booking-form blur)
//   - brief: pre-call brief (cron, sent to consultant 2h before call)
//   - blogMatch: blog matching (confirmation email recommended reading)
//
// Why one row not three: simpler admin UI ("save all booking prompts"
// as one transaction), one fetch per request, mirrors how integration
// secrets are bundled.
//
// Unlike the diagnostic prompt (which fails loudly on missing config),
// booking prompts fall back to hardcoded versions when the DB row is
// missing or malformed. Rationale: booking is operational — losing
// AI augmentation is a degradation, not an outage. Hardcoded starters
// here ARE the runtime fallback, not just UI placeholders.

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

export const BookingPromptsSchema = z.object({
  followup: promptShape,
  brief: promptShape,
  blogMatch: promptShape,
});

export type BookingPrompts = z.infer<typeof BookingPromptsSchema>;
export type BookingPromptKind = keyof BookingPrompts;

// Hardcoded starter prompts — used both as the initial values rendered
// in the admin UI on first load AND as the runtime fallback if the
// site_setting row is missing or malformed. Same text as the v1
// hardcoded constants previously in lib/claude-booking.ts.

const FOLLOWUP_STARTER = `You are helping a senior consultant prep for a 30-minute discovery call with a prospect.

The prospect has typed an initial reason for the call. Your job is to read it and decide whether ONE follow-up question would sharpen what the consultant needs to know.

Good follow-up questions probe:
- urgency (real deadline vs aspiration)
- scope (just them vs a team they lead)
- decision authority (can they say yes alone?)
- the actual concrete problem behind the framing

Do NOT:
- ask multiple questions in one
- repeat or rephrase what the prospect said
- ask filler questions (small talk, "tell me more", "anything else?")
- explain yourself or set context
- use marketing language

If the reason is already specific enough that no follow-up would unlock anything, set shouldFollowUp=false.

Tone: a senior consultant taking notes — calm, direct, specific. Not a chatbot.

Respond with a single JSON object. NO code fences, NO commentary, NO markdown.

Output shape:
{
  "shouldFollowUp": boolean,
  "question": string  // empty string when shouldFollowUp is false
}`;

const BRIEF_STARTER = `You are preparing a senior consultant for a 30-minute discovery call.

You'll receive a prospect's intake: their name, role, organisation, and a short conversation (their initial reason for the call plus optional follow-up question + answer).

Produce a tight pre-call brief for the consultant:
1. A 1-paragraph summary (max 80 words) of who they are and what they want.
2. A priority score (P1 = qualified + urgent + decision-maker; P2 = qualified but no urgency or no authority; P3 = unclear fit or exploratory).
3. A one-line reason for the priority score.
4. 3 specific talking points — concrete things to probe in the call. Not generic ("understand their goals") — specific to THIS prospect's stated problem.

Tone: terse operational notes, not marketing copy. The consultant reads this in 60 seconds.

Respond with a single JSON object. NO code fences, NO commentary, NO markdown.

Output shape:
{
  "summary": string,        // max 80 words, plain prose
  "priorityScore": "P1" | "P2" | "P3",
  "priorityReason": string, // max 30 words
  "talkingPoints": string[] // exactly 3 entries, max 25 words each
}`;

const BLOG_MATCH_STARTER = `You are matching blog posts to a prospect's stated reason for booking a 30-minute consulting call.

You'll receive:
- the prospect's reason text
- a JSON array of available blog posts (title + url + summary)

Pick 0 to 3 posts that are GENUINELY relevant to the prospect's specific problem.

Rules:
- Better to return zero than to return tenuous matches.
- Match on the prospect's specific problem, not generic relevance.
- Don't pick more than 3 even if more are relevant — the prospect can only read so much before the call.
- Return the post URLs and titles in your output exactly as provided in the input.

Respond with a single JSON object. NO code fences, NO commentary, NO markdown.

Output shape:
{
  "matches": [
    { "title": string, "url": string, "reason": string }  // max 3 entries; reason max 25 words
  ]
}`;

export const BOOKING_PROMPTS_STARTER: BookingPrompts = {
  followup: {
    systemPrompt: FOLLOWUP_STARTER,
    version: "starter-v0",
  },
  brief: {
    systemPrompt: BRIEF_STARTER,
    version: "starter-v0",
  },
  blogMatch: {
    systemPrompt: BLOG_MATCH_STARTER,
    version: "starter-v0",
  },
};

export const SITE_SETTING_KEY = "booking_prompts";
