// Skills are the pipeline's prompts, and they live in the database, not in code, so
// Rob edits them in the admin. This file loads one by slug and turns it into the two
// strings a model call needs, with every piece of untrusted text fenced.
//
// A skill that uses a {{variable}} the pipeline does not supply is an error that
// names it. A prompt silently sent with a hole in it would produce a plausible,
// wrong post.

import { eq } from "drizzle-orm";
import type { DB } from "../../db";
import { skill } from "../../db/schema";
import { fenceValue, newFenceMarker, untrustedFenceInstruction } from "../../workflows/fence";

export interface SkillPrompt {
  slug: string;
  system: string | null;
  template: string;
  temperature: number | null;
  maxTokens: number | null;
}

/** A skill is missing, empty, or uses a variable the pipeline does not supply. */
export class SkillSetupError extends Error {
  override name = "SkillSetupError";
}

export async function loadSkill(db: DB, slug: string): Promise<SkillPrompt> {
  const [row] = await db
    .select({
      system: skill.systemPrompt,
      template: skill.promptTemplate,
      temperature: skill.temperature,
      maxTokens: skill.maxTokens,
    })
    .from(skill)
    .where(eq(skill.slug, slug))
    .limit(1);
  if (!row) throw new SkillSetupError(`skill "${slug}" does not exist`);
  if (!row.template || row.template.trim().length === 0) throw new SkillSetupError(`skill "${slug}" has an empty prompt`);
  return {
    slug,
    system: row.system ?? null,
    template: row.template,
    temperature: row.temperature === null ? null : Number(row.temperature),
    maxTokens: row.maxTokens ?? null,
  };
}

export interface PromptInputs {
  /** Operator-written or code-written text: filled as it is. */
  plain?: Record<string, string>;
  /** Anything from the open web, or from a model that read it: fenced. */
  untrusted?: Record<string, string>;
  /**
   * Text added after the template, fenced: the problems found in a previous try, or
   * review notes. It is data about the work, never new instructions about format or facts.
   */
  appendix?: { heading: string; text: string };
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
export const clean = (v: string) => v.replace(/[^\P{Cc}\t\n\r]/gu, "");

export function buildPrompt(s: SkillPrompt, inputs: PromptInputs): { system: string | undefined; user: string } {
  const marker = newFenceMarker();
  const untrusted = Object.entries(inputs.untrusted ?? {}).filter(([, v]) => v.length > 0);
  const hasFence = untrusted.length > 0 || Boolean(inputs.appendix?.text);
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs.plain ?? {})) vars[k] = clean(v);
  for (const [k, v] of untrusted) vars[k] = fenceValue(clean(v), marker);
  for (const k of Object.keys(inputs.untrusted ?? {})) vars[k] ??= ""; // an empty untrusted input is empty, not missing

  const missing = [...new Set([...s.template.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((k) => !(k in vars)))];
  if (missing.length > 0) {
    throw new SkillSetupError(`skill "${s.slug}" uses {{${missing.join("}}, {{")}}} which the pipeline does not supply`);
  }

  // One pass over the TEMPLATE, so a placeholder inside an input is never expanded.
  let user = s.template.replace(PLACEHOLDER, (_, k: string) => vars[k]);
  if (inputs.appendix?.text) user += `\n\n${inputs.appendix.heading}\n${fenceValue(clean(inputs.appendix.text), marker)}`;
  // The system prompt only refers to inputs by name; the text itself is in the user message.
  const systemBase = s.system?.replace(PLACEHOLDER, (_, k: string) => `the ${k.replace(/_/g, " ")} given below`) ?? null;
  const system = [systemBase, hasFence ? untrustedFenceInstruction(marker) : null].filter(Boolean).join("\n\n");
  return { system: system.length > 0 ? system : undefined, user };
}
