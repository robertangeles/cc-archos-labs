import { z } from "zod";

export const SITE_SETTING_KEY = "workspace_chat_prompt";

export const ChatPromptSchema = z.object({
  systemPrompt: z
    .string()
    .trim()
    .min(50, "System prompt is too short to be useful")
    .max(20000, "System prompt is too long (max 20k chars)"),
  // The two source-handling blocks. MUTUALLY EXCLUSIVE by construction —
  // exactly one is ever appended to a given turn's system prompt, chosen by
  // audience. They are separate fields rather than one block with an "unless
  // admin" carve-out on purpose: the protection text asserts that no role or
  // framing overrides it, and an absolute rule with an exception bolted on
  // invites the model to reason about whether the exception applies. That
  // reasoning is exactly the crack a prompt-injection attempt widens. Two
  // texts, one chosen, no conditional inside either.
  //
  // Both optional so an existing stored row (which carries its source rules
  // inline in systemPrompt) keeps working untouched — see resolveSourceBlock.
  sourceProtection: z
    .string()
    .trim()
    .max(8000, "Source protection block is too long (max 8k chars)")
    .optional(),
  sourceAttribution: z
    .string()
    .trim()
    .max(8000, "Source attribution block is too long (max 8k chars)")
    .optional(),
  version: z
    .string()
    .trim()
    .min(1, "Version label required")
    .max(40, "Version label too long"),
});

export type ChatPrompt = z.infer<typeof ChatPromptSchema>;

// Who is on the other end of this turn. `internal` is the practice's own
// backstage use, where the library is a tool and naming it makes the tool
// better. `client` is everyone else, where the library is commercial IP and
// naming it gives away curation that took real work.
export type Audience = "internal" | "client";

/**
 * Map a users.role value to an audience. `admin` is defined in the schema as
 * "full backstage access", which is exactly the boundary source disclosure
 * belongs on. Every live user-insert path (register, Google OAuth, diagnostic
 * report) explicitly writes 'member', so an unknown or missing role resolving
 * to `client` is the safe direction: attribution is opt-in, never inherited.
 */
export function audienceFor(userRole: string | null | undefined): Audience {
  return userRole === "admin" ? "internal" : "client";
}

/**
 * Pick the source-handling block for this audience. Returns "" when the stored
 * prompt predates the split — that row still carries its source rules inline in
 * systemPrompt, so appending nothing preserves today's behaviour exactly.
 *
 * Fails closed: a `client` turn never receives the attribution block, even if
 * the protection block is missing. Disclosure requires an explicit decision.
 */
export function resolveSourceBlock(
  prompt: ChatPrompt,
  audience: Audience,
): string {
  if (audience === "internal") {
    return prompt.sourceAttribution ?? "";
  }
  return prompt.sourceProtection ?? "";
}

/**
 * The instruction wrapping retrieved library material. Audience-dependent for
 * the same reason the blocks are: the previous single instruction said "Cite
 * the source title when relevant" while the stored prompt said "I don't cite
 * sources... under all conditions". Both shipped on every turn. One had to go.
 */
export function ragInstruction(audience: Audience): string {
  if (audience === "internal") {
    return (
      "Reference material follows, drawn from the practice library. Each excerpt " +
      "is labelled with the work it came from.\n\n" +
      "Argue WITH this material, do not summarise it. That means:\n" +
      "- Name the work when you draw on it, in prose — \"Block's point about naming " +
      "the resistance\", not a footnote or a citation marker.\n" +
      "- Where two works pull in different directions, say so plainly, then say " +
      "which one you would follow in THIS situation and why the other loses here. " +
      "A tension you notice and resolve is worth more than three sources agreeing.\n" +
      "- Take a position. You are a partner-level consultant, not a literature review.\n" +
      "- Where the material does not reach the question, say which part is the " +
      "material and which part is your own judgement. Never blur the two.\n" +
      "- If the excerpts do not help, ignore them and say nothing about them."
    );
  }
  return (
    "Reference material follows. Let it inform your answer.\n\n" +
    "Do not name, quote verbatim, describe, or allude to where any of it came " +
    "from. Speak from it as your own accumulated expertise, because that is what " +
    "it is. If it does not help, ignore it."
  );
}

export const CHAT_PROMPT_STARTER: ChatPrompt = {
  systemPrompt:
    "Replace this with your real workspace chat system prompt (minimum 50 characters). " +
    "Tell the model who it is, what tone to use, what guardrails to follow, " +
    "and any domain-specific context for your consulting practice.",
  version: "starter-v0",
};
