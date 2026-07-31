// Shared source-handling text and extraction logic for the Metis prompt split.
//
// Imported by BOTH split-chat-prompt-source-blocks.mjs (which writes it) and
// prompt-ab.mjs (which measures it). One definition so the text that gets
// measured is byte-identical to the text that gets stored — a drifted copy
// would make the A/B result a measurement of the wrong prompt.
//
// No side effects, no DB access: safe to import.

export const PROTECTION_HEADING = "## KNOWLEDGE SOURCE PROTECTION";

// The internal-session block. This is the substantive half of the change: it is
// what lets Metis do the thing the library exists for — hold a position and
// argue across named works — rather than blending them into an unattributable
// summary. Deliberately NOT a citation format. Citation markers make prose read
// like a literature review; naming a work mid-sentence is how a consultant
// actually talks.
export const ATTRIBUTION = `## SOURCE HANDLING — INTERNAL SESSION

You are working with the practice's own library, with someone who owns it. Name
what you draw on and argue with it.

- Name the work in prose as you use it — "Block's point about naming the
  resistance", "Kimball would model this as a conformed dimension". Not
  footnotes, not citation markers, not a reference list at the end.
- When two works pull in different directions, say so, then commit: which one
  applies HERE, and why the other one loses in this situation. A tension you
  name and resolve is worth more than three works agreeing.
- Separate what the material says from what you think. "The material covers X;
  what it does not address, and what I would actually do, is Y." Never blur
  those two together.
- When the library has nothing useful on the question, say that plainly and
  answer from your own judgement, flagged as such. Silence about a gap reads as
  false grounding.
- Never invent a title, an author, or a claim. If you did not draw on a work,
  do not name it.

This block applies to internal sessions only. It replaces the client-session
source rules entirely — the two never appear together.`;

// The RAG instruction that shipped before the split, verbatim from the old
// stream.ts:80-81. Kept for the A/B's control arm — it is the thing being
// replaced, and it contradicted the protection block it shipped alongside.
export const OLD_RAG_INSTRUCTION =
  "Use the following knowledge base context to inform your response. " +
  "Cite the source title when relevant. If the context doesn't help, ignore it.";

// Mirrors ragInstruction("client") in lib/chat/prompt-config-shared.ts.
// Same duplication caveat and same drift test as NEW_RAG_INSTRUCTION below.
export const CLIENT_RAG_INSTRUCTION =
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
  "- Mark where established practice ends and your own call begins — \"that is " +
  "the standard play; going further than that is my call and here is why I " +
  "would\". State it with the same conviction as everything else. This is " +
  "precision about the terrain, not hedging, and a partner-level consultant " +
  "does it as a matter of course.\n" +
  "- Never say or imply you consulted anything. No \"the literature\", no " +
  "\"studies show\", no \"one framework suggests\", no \"in my reading\". You are " +
  "speaking from practice.";

// Mirrors ragInstruction("internal") in lib/chat/prompt-config-shared.ts.
// That module is server-only and cannot be imported from a plain node script,
// so the text is duplicated here and asserted equal by a unit test.
export const NEW_RAG_INSTRUCTION =
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
  "- If the excerpts do not help, ignore them and say nothing about them.";

/**
 * Split a stored systemPrompt into { core, protection }.
 *
 * The protection section runs from its heading to the next top-level heading,
 * or to the end of the prompt. Returns protection: null when the heading is
 * absent — callers decide whether that is "already split" or "unexpected".
 */
export function extractProtection(systemPrompt) {
  const start = systemPrompt.indexOf(PROTECTION_HEADING);
  if (start === -1) return { core: systemPrompt, protection: null };

  const rest = systemPrompt.slice(start + PROTECTION_HEADING.length);
  const nextHeading = rest.search(/^## /m);
  const end =
    nextHeading === -1
      ? systemPrompt.length
      : start + PROTECTION_HEADING.length + nextHeading;

  return {
    core: (systemPrompt.slice(0, start) + systemPrompt.slice(end))
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    protection: systemPrompt.slice(start, end).trim(),
  };
}
