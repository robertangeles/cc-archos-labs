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
  // Reasoning quality and source disclosure are SEPARATE concerns, and only the
  // second one is commercially sensitive. Surfacing a genuine trade-off and
  // being honest about the edge of your knowledge reveal nothing about what is
  // on the shelf — so a client turn gets those, and only the attribution is
  // withheld. Measured lift on the internal arm was tension 4/10 -> 9/10 and
  // material-vs-judgement 0/10 -> 9/10; there is no reason a client should get
  // the flat summarising behaviour instead.
  //
  // The entire boundary lives in the WORDING. "Two ways to sequence this trade
  // off against each other" is safe; "two of my sources disagree" confirms the
  // library exists, which KNOWLEDGE SOURCE PROTECTION forbids. Hence the
  // explicit vocabulary ban in the last bullet, and the tests that assert this
  // string carries no source-implying language.
  return (
    "Reference material follows. Let it inform your answer.\n\n" +
    "Do not name, quote verbatim, describe, or allude to where any of it came " +
    "from. Speak from it as your own accumulated expertise, because that is what " +
    "it is. If it does not help, ignore it.\n\n" +
    "Within that constraint, reason properly rather than summarising:\n" +
    "- Take a position. Commit to a recommendation instead of listing options.\n" +
    "- Where there are genuinely competing approaches, surface the tension as a " +
    "tension in the PROBLEM, never between texts — \"there are two ways to " +
    "sequence this and they trade off against each other\" — then say which one " +
    "applies here and why the other loses.\n" +
    // Worded as PRECISION, not uncertainty, on purpose. The identity section of
    // the stored prompt says "You do not hedge when you know the answer. You do
    // not soften expertise to seem approachable." A bullet asking Metis to say
    // "this is my judgement call" reads as exactly that hedging and gets
    // suppressed — measured 0/10 on the client arm when phrased that way, while
    // the internal arm scored 9/10 because attribution gave it a concrete,
    // non-hedging frame ("the material covers X; what it does not address is Y").
    // Naming which claims are industry-settled versus which are this
    // consultant's call is a mark of expertise, so it has to be framed as one.
    "- Mark where established practice ends and your own call begins — \"that is " +
    "the standard play; going further than that is my call and here is why I " +
    "would\". State it with the same conviction as everything else. This is " +
    "precision about the terrain, not hedging, and a partner-level consultant " +
    "does it as a matter of course.\n" +
    "- Never say or imply you consulted anything. No \"the literature\", no " +
    "\"studies show\", no \"one framework suggests\", no \"in my reading\". You are " +
    "speaking from practice."
  );
}

/**
 * Notice injected when retrieval found nothing substantive, or could not run.
 *
 * These are DIFFERENT STATES and must read differently. "I looked and there is
 * nothing there" is honest scoping; "I could not look" is a degraded service.
 * Conflating them teaches the user that the gap notice is noise, which destroys
 * the value of both.
 *
 * Modelled on EMPTY_BRAIN_NOTICE in stream.ts: the ABSENCE of context is not a
 * signal a model reads. On an empty brain it invents a persona; on an empty
 * shelf it answers with the same confidence as a grounded turn. The empty state
 * has to be stated, in the present tense, next to the question.
 *
 * Audience-aware for the same reason everything else here is: telling a client
 * "I could not reach the library" confirms a library exists, which is exactly
 * what the protection block forbids. The client wording conveys the same
 * epistemic fact without the disclosure.
 */
export function coverageNotice(
  state: "uncovered" | "thin" | "degraded",
  audience: Audience,
): string {
  if (state === "degraded") {
    return audience === "internal"
      ? "## Retrieval unavailable\n" +
          "The practice library could not be reached for this turn. Answer from " +
          "your own judgement and say plainly, once, that you are doing so " +
          "without your usual reference material. Do NOT present this answer as " +
          "grounded, and do not name any work — you have not seen one."
      : "## Reference material unavailable\n" +
          "You are answering from general expertise this turn. Say once, plainly, " +
          "that this is your read rather than settled practice. Do not explain " +
          "why, and do not imply anything was consulted or unavailable.";
  }
  if (state === "thin") {
    // A FOURTH state, and it exists because conflating it with "uncovered" was
    // a real defect: material WAS retrieved and injected, and the uncovered
    // copy asserts "nothing relevant was retrieved, so naming one would be an
    // invention" — flatly false with excerpts sitting directly above it.
    // Telling the model both at once is worse than telling it neither.
    return audience === "internal"
      ? "## Thin coverage\n" +
          "What you were given above is all the library has on this, and it is " +
          "thin — enough to inform an answer, not enough to ground one. Use it " +
          "and name those works, but say plainly where you go past what they " +
          "support and into your own judgement. Do not stretch a handful of " +
          "passages into a confident position."
      : "## Limited established ground\n" +
          "There is less settled practice behind this than usual. Answer, and " +
          "mark clearly where you move from the standard play to your own call. " +
          "Do not imply anything was consulted or is missing.";
  }

  return audience === "internal"
    ? "## Nothing in the library covers this\n" +
        "The library has no substantive material on this question. Say so " +
        "plainly — a gap named is worth more than an answer dressed up as " +
        "grounded — then answer from your own judgement, flagged as such. Do " +
        "NOT name a work: nothing relevant was retrieved, so naming one would " +
        "be an invention."
    : "## Outside the well-trodden ground\n" +
        "This sits outside established practice. Answer from judgement and mark " +
        "it as your call rather than the standard play. Do not imply you " +
        "consulted anything, and do not say anything is missing.";
}

export const CHAT_PROMPT_STARTER: ChatPrompt = {
  systemPrompt:
    "Replace this with your real workspace chat system prompt (minimum 50 characters). " +
    "Tell the model who it is, what tone to use, what guardrails to follow, " +
    "and any domain-specific context for your consulting practice.",
  version: "starter-v0",
};
