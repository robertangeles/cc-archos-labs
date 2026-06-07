import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  workflowStep,
  workflowExecutionRun,
  workflowExecutionLog,
  skill,
  skillInput,
  skillOutput,
} from "../db/schema";
import { executeSkill } from "../skills/execute";
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

  const context: Record<string, string> = { ...inputs };
  const stepResults: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStart = Date.now();
    const skillName = await getSkillName(step.skillId);

    console.log(JSON.stringify({
      event: "step_start",
      workflowId,
      stepIndex: i,
      skillName,
      model: step.model || "default",
      userId,
    }));

    try {
      const resolved = await resolveStepInputs(step, context);
      const skillConfig = step.skillId
        ? await loadSkillConfig(step.skillId)
        : null;

      const promptTemplate = skillConfig?.promptTemplate ?? step.prompt;
      const systemPrompt = (step.overrides as Record<string, unknown>)?.systemPrompt as string | undefined
        ?? skillConfig?.systemPrompt
        ?? undefined;
      const temperature = (step.overrides as Record<string, unknown>)?.temperature as number | undefined
        ?? skillConfig?.temperature
        ?? undefined;
      const maxTokens = (step.overrides as Record<string, unknown>)?.maxTokens as number | undefined
        ?? skillConfig?.maxTokens
        ?? undefined;
      const model = step.model || skillConfig?.defaultModel || "anthropic/claude-sonnet-4.6";

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

      context[`step_${step.stepId}.${outputKey}`] = response.result;
      context[`step_${step.stepId}.result`] = response.result;

      const result: StepResult = {
        stepId: step.stepId,
        skillId: step.skillId ?? "raw",
        outputs: { [outputKey]: response.result },
        usage: response.usage,
        model: response.model,
        durationMs,
        status: "success",
      };
      stepResults.push(result);

      console.log(JSON.stringify({
        event: "step_complete",
        workflowId,
        stepIndex: i,
        skillName,
        model: response.model,
        durationMs,
        status: "success",
        userId,
      }));
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      const message = err instanceof Error ? err.message : "Unknown error";

      stepResults.push({
        stepId: step.stepId,
        skillId: step.skillId ?? "raw",
        outputs: {},
        usage: { inputTokens: 0, outputTokens: 0 },
        model: step.model || "unknown",
        durationMs,
        status: "error",
        error: message,
      });

      console.log(JSON.stringify({
        event: "step_error",
        workflowId,
        stepIndex: i,
        skillName,
        error: message,
        durationMs,
        userId,
      }));
      break;
    }
  }

  const totalDurationMs = Date.now() - start;
  const allSucceeded = stepResults.every((r) => r.status === "success");

  try {
    await db.insert(workflowExecutionRun).values({
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

  try {
    for (let i = 0; i < stepResults.length; i++) {
      const r = stepResults[i];
      const s = steps[i];
      await db.insert(workflowExecutionLog).values({
        runId: undefined as unknown as string,
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

  return {
    workflowId,
    status: allSucceeded ? "completed" as const : "failed" as const,
    stepResults,
    totalDurationMs,
  };
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

async function getSkillName(skillId: string | null): Promise<string> {
  if (!skillId) return "Raw Prompt";
  const db = getDb();
  const [s] = await db
    .select({ name: skill.name })
    .from(skill)
    .where(eq(skill.id, skillId))
    .limit(1);
  return s?.name ?? "Unknown Skill";
}
