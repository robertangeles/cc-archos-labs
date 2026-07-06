import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  workflowStep,
  workflowExecutionLog,
  skill,
  skillInput,
  skillOutput,
} from "../db/schema";
import { executeSkill } from "../skills/execute";
import { getEnabledRules, formatRulesForInjection } from "../rules/service";
import { resolveLlmConfig } from "../llm/config";
import { persistRun } from "./runs";
import type { StepResult } from "./types";

export async function executeWorkflow(
  workflowId: string,
  userId: string,
  inputs: Record<string, string>,
) {
  const db = getDb();
  const start = Date.now();

  const steps = await db
    .select()
    .from(workflowStep)
    .where(eq(workflowStep.workflowId, workflowId))
    .orderBy(workflowStep.sortOrder);

  if (steps.length === 0) {
    throw new Error("Workflow has no steps to execute");
  }

  const enabledRules = await getEnabledRules(userId);
  const rulesBlock = formatRulesForInjection(enabledRules);

  const context: Record<string, string> = { ...inputs };
  const stepResults: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const skillName = await getSkillName(step.skillId);

    console.log(JSON.stringify({
      event: "step_start",
      workflowId,
      stepIndex: i,
      skillName,
      model: step.model || "default",
      userId,
    }));

    const { result, contextPatch } = await executeStep(step, context, rulesBlock);
    Object.assign(context, contextPatch);
    stepResults.push(result);

    if (result.status === "success") {
      console.log(JSON.stringify({
        event: "step_complete",
        workflowId,
        stepIndex: i,
        skillName,
        model: result.model,
        durationMs: result.durationMs,
        status: "success",
        userId,
      }));
    } else {
      console.log(JSON.stringify({
        event: "step_error",
        workflowId,
        stepIndex: i,
        skillName,
        error: result.error,
        durationMs: result.durationMs,
        userId,
      }));
      break;
    }
  }

  const totalDurationMs = Date.now() - start;
  const allSucceeded = stepResults.every((r) => r.status === "success");

  let runId: string | null = null;
  try {
    runId = await persistRun({
      workflowId,
      userId,
      inputs,
      stepResults,
      status: allSucceeded ? "completed" : "failed",
      totalDurationMs,
    });
  } catch {
    // non-blocking
  }

  if (runId) {
    try {
      for (let i = 0; i < stepResults.length; i++) {
        const r = stepResults[i];
        const s = steps[i];
        await db.insert(workflowExecutionLog).values({
          runId,
          workflowId,
          userId,
          stepIndex: i,
          skillName: await getSkillName(s.skillId),
          skillId: s.skillId,
          model: r.model,
          inputTokens: r.usage.inputTokens,
          outputTokens: r.usage.outputTokens,
          durationMs: r.durationMs,
          status: r.status,
        });
      }
    } catch {
      // non-blocking telemetry
    }
  }

  return {
    workflowId,
    status: allSucceeded ? "completed" as const : "failed" as const,
    stepResults,
    totalDurationMs,
  };
}

export async function* executeWorkflowStreaming(
  workflowId: string,
  userId: string,
  inputs: Record<string, string>,
): AsyncGenerator<
  | { type: "step_start"; index: number; total: number; skillName: string }
  | { type: "step_result"; result: StepResult }
  | { type: "done"; status: "completed" | "failed"; totalDurationMs: number; runId: string | null }
> {
  const db = getDb();
  const start = Date.now();

  const steps = await db
    .select()
    .from(workflowStep)
    .where(eq(workflowStep.workflowId, workflowId))
    .orderBy(workflowStep.sortOrder);

  if (steps.length === 0) throw new Error("Workflow has no steps to execute");

  const enabledRules = await getEnabledRules(userId);
  const rulesBlock = formatRulesForInjection(enabledRules);
  const context: Record<string, string> = { ...inputs };
  const stepResults: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const skillName = await getSkillName(step.skillId);

    yield { type: "step_start", index: i, total: steps.length, skillName };

    const { result, contextPatch } = await executeStep(step, context, rulesBlock);
    Object.assign(context, contextPatch);
    stepResults.push(result);
    yield { type: "step_result", result };

    if (result.status === "error") break;
  }

  const totalDurationMs = Date.now() - start;
  const allSucceeded = stepResults.every((r) => r.status === "success");
  const status = allSucceeded ? "completed" as const : "failed" as const;

  let runId: string | null = null;
  try {
    runId = await persistRun({
      workflowId, userId, inputs, stepResults, status, totalDurationMs,
    });
  } catch { /* non-blocking */ }

  if (runId) {
    try {
      for (let i = 0; i < stepResults.length; i++) {
        const r = stepResults[i];
        const s = steps[i];
        await db.insert(workflowExecutionLog).values({
          runId,
          workflowId, userId, stepIndex: i,
          skillName: await getSkillName(s.skillId),
          skillId: s.skillId, model: r.model,
          inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens,
          durationMs: r.durationMs, status: r.status,
        });
      }
    } catch { /* non-blocking */ }
  }

  yield { type: "done", status, totalDurationMs, runId };
}

/**
 * Execute ONE workflow step against a context snapshot.
 *
 * This is the single per-step primitive shared by executeWorkflow (eager) and
 * executeWorkflowStreaming (SSE). It owns ONLY the per-step work — nothing about
 * how the caller logs, streams, persists, or decides to stop. It never throws:
 * a failed step comes back as a StepResult with status "error" so the caller
 * chooses whether to break. The Regenerate feature (PR2) drives this same
 * primitive to resume from an arbitrary step.
 *
 *   step + context ─▶ resolve inputs ─▶ load skill config ─▶ executeSkill (LLM)
 *                                                                   │
 *        contextPatch (step_${id}.${outputKey}, step_${id}.result) ◀┘
 *                          │
 *                          ▼
 *            { result: StepResult, contextPatch }   (caller applies the patch)
 *
 * On error: result.status = "error", outputs {}, contextPatch {} (no keys added).
 */
export async function executeStep(
  step: typeof workflowStep.$inferSelect,
  context: Record<string, string>,
  rulesBlock: string | null,
  opts: { modelOverride?: string; feedbackAddendum?: string } = {},
): Promise<{ result: StepResult; contextPatch: Record<string, string> }> {
  const stepStart = Date.now();

  try {
    const resolved = await resolveStepInputs(step, context);
    const skillConfig = step.skillId
      ? await loadSkillConfig(step.skillId)
      : null;

    const promptTemplate = skillConfig?.promptTemplate ?? step.prompt;
    const baseSystemPrompt = (step.overrides as Record<string, unknown>)?.systemPrompt as string | undefined
      ?? skillConfig?.systemPrompt
      ?? undefined;
    // Compose the system prompt from base + injected rules + optional regenerate
    // feedback. filter(Boolean) drops empty/undefined parts; an all-empty result
    // stays undefined (not ""), preserving the original no-system-prompt case.
    const promptParts = [baseSystemPrompt, rulesBlock, opts.feedbackAddendum].filter(
      Boolean,
    ) as string[];
    const systemPrompt = promptParts.length > 0 ? promptParts.join("\n\n") : undefined;
    const temperature = (step.overrides as Record<string, unknown>)?.temperature as number | undefined
      ?? skillConfig?.temperature
      ?? undefined;
    const maxTokens = (step.overrides as Record<string, unknown>)?.maxTokens as number | undefined
      ?? skillConfig?.maxTokens
      ?? undefined;
    const configuredDefault = (await resolveLlmConfig()).modelId;
    const model = opts.modelOverride || step.model || skillConfig?.defaultModel || configuredDefault;

    const response = await executeSkill({
      promptTemplate,
      systemPrompt,
      inputs: resolved,
      model,
      temperature,
      maxTokens,
    });

    const durationMs = Date.now() - stepStart;
    const outputKey = skillConfig?.outputKey ?? "result";

    const contextPatch: Record<string, string> = {
      [`step_${step.stepId}.${outputKey}`]: response.result,
      [`step_${step.stepId}.result`]: response.result,
    };

    const result: StepResult = {
      stepId: step.stepId,
      skillId: step.skillId ?? "raw",
      outputs: { [outputKey]: response.result },
      usage: response.usage,
      model: response.model,
      durationMs,
      status: "success",
    };

    return { result, contextPatch };
  } catch (err) {
    const durationMs = Date.now() - stepStart;
    const message = err instanceof Error ? err.message : "Unknown error";

    const result: StepResult = {
      stepId: step.stepId,
      skillId: step.skillId ?? "raw",
      outputs: {},
      usage: { inputTokens: 0, outputTokens: 0 },
      model: step.model || "unknown",
      durationMs,
      status: "error",
      error: message,
    };

    return { result, contextPatch: {} };
  }
}

async function resolveStepInputs(
  step: typeof workflowStep.$inferSelect,
  context: Record<string, string>,
): Promise<Record<string, string>> {
  const mappings = (step.inputMappings as Record<string, string>) ?? {};
  const resolved: Record<string, string> = {};

  for (const [inputKey, source] of Object.entries(mappings)) {
    if (!source) continue;
    if (source.startsWith("step_")) {
      resolved[inputKey] = context[source] ?? "";
    } else {
      resolved[inputKey] = context[source] ?? "";
    }
  }

  // Also map direct context keys matching input keys (auto-mapping)
  if (step.skillId) {
    const db = getDb();
    const inputs = await db
      .select({ key: skillInput.key })
      .from(skillInput)
      .where(eq(skillInput.skillId, step.skillId));

    for (const inp of inputs) {
      if (!resolved[inp.key] && context[inp.key]) {
        resolved[inp.key] = context[inp.key];
      }
    }
  }

  return resolved;
}

async function loadSkillConfig(skillId: string) {
  const db = getDb();
  const [s] = await db
    .select({
      promptTemplate: skill.promptTemplate,
      systemPrompt: skill.systemPrompt,
      defaultModel: skill.defaultModel,
      temperature: skill.temperature,
      maxTokens: skill.maxTokens,
    })
    .from(skill)
    .where(eq(skill.id, skillId))
    .limit(1);

  if (!s) return null;

  const [output] = await db
    .select({ key: skillOutput.key })
    .from(skillOutput)
    .where(eq(skillOutput.skillId, skillId))
    .limit(1);

  return {
    promptTemplate: s.promptTemplate ?? "",
    systemPrompt: s.systemPrompt ?? undefined,
    defaultModel: s.defaultModel ?? undefined,
    temperature: s.temperature ? Number(s.temperature) : undefined,
    maxTokens: s.maxTokens ?? undefined,
    outputKey: output?.key ?? "result",
  };
}

export async function getSkillName(skillId: string | null): Promise<string> {
  if (!skillId) return "Raw Prompt";
  const db = getDb();
  const [s] = await db
    .select({ name: skill.name })
    .from(skill)
    .where(eq(skill.id, skillId))
    .limit(1);
  return s?.name ?? "Unknown Skill";
}
