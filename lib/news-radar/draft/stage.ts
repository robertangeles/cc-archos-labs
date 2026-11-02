import type { ChatResult, Llm } from "./llm";
import { buildPrompt, type PromptInputs, type SkillPrompt } from "./skills";
import { stepFromChat, type StepLog } from "./types";

export interface StageDeps {
  llm: Llm;
  skill: (slug: string) => Promise<SkillPrompt>;
}

/**
 * One skill, one model call, one step record: load the prompt, fill and fence the
 * inputs, call the model. A skill's own temperature is not sent: the newest models
 * reject some sampling settings, and the pipeline's prompts were proved without one.
 * A skill's own max_tokens is not used either: the skill rows carry limits (2000 to
 * 4000) from older models, and a reasoning model spends part of its budget thinking,
 * so a limit that small returns a short draft instead of an essay. The default is 32000.
 */
export async function runSkill(
  deps: StageDeps,
  o: { slug: string; label: string; model: string; inputs: PromptInputs; maxTokens?: number; timeoutMs?: number },
): Promise<{ res: ChatResult; step: StepLog }> {
  const skill = await deps.skill(o.slug);
  const { system, user } = buildPrompt(skill, o.inputs);
  const res = await deps.llm({
    label: o.label,
    model: o.model,
    system,
    user,
    maxTokens: o.maxTokens,
    timeoutMs: o.timeoutMs,
  });
  return { res, step: stepFromChat(o.label, res) };
}
