import "server-only";
import { executeStep, getSkillName } from "./executor";
import { getEnabledRules, formatRulesForInjection } from "../rules/service";
import { amendRun, type RunDetail, type RunStatus } from "./runs";
import type { StepResult } from "./types";
import type { workflowStep } from "../db/schema";

// ============================================================================
// Per-step Regenerate — resume-from-step-N over a persisted run.
//
//   run snapshot ─▶ rebuild prefix context ─▶ preflight (eligibility + drift)
//                                                     │ ok                │ fail
//                                                     ▼                   ▼
//                      executeStep(target..end) ─▶ amend in place       409 / 404
//                      (overwrite ONLY on success, append for failed-resume)
//                                                     │
//                                                     ▼
//                               amendRun (single write, rows-affected guard)
//
// The client never supplies execution context — the server rebuilds it from the
// run's own inputs + step_results so a stale/hostile client can't inject state.
// ============================================================================

// --- In-process concurrency guard (single-instance, single-user today) -------
// Rejects a second regenerate on a run that is already regenerating. Last-write-
// wins across instances is accepted for v1 (see the deployment notes); revisit a
// durable lock at the org migration.
const activeRuns = new Set<string>();

export function tryAcquireRun(runId: string): boolean {
  if (activeRuns.has(runId)) return false;
  activeRuns.add(runId);
  return true;
}

export function releaseRun(runId: string): void {
  activeRuns.delete(runId);
}

// --- Pure: rebuild the context a step would see, from the run snapshot -------
// Seeds the run's persisted inputs, then for each successful prior step adds
// BOTH key forms the executor writes: step_<id>.<outputKey> and step_<id>.result.
export function rebuildContext(
  inputs: Record<string, string>,
  prefix: StepResult[],
): Record<string, string> {
  const context: Record<string, string> = { ...inputs };
  for (const r of prefix) {
    if (r.status !== "success") continue;
    const first = Object.values(r.outputs)[0] ?? "";
    for (const [k, v] of Object.entries(r.outputs)) {
      context[`step_${r.stepId}.${k}`] = v;
    }
    context[`step_${r.stepId}.result`] = first;
  }
  return context;
}

type StepLike = {
  stepId: string;
  inputMappings: Record<string, string> | null | unknown;
};

export type PreflightResult =
  | {
      ok: true;
      targetPos: number;
      targetSnapshotIndex: number;
      stepsToRun: number[];
    }
  | { ok: false; code: 404 | 409; reason: string };

// --- Pure: eligibility + drift guard over the steps that will run ------------
// Refuses (409/404) when the run can't be safely resumed: target missing from
// the run or the workflow, an unsuccessful prefix step, or a step-to-run whose
// current input mapping references output that the saved run doesn't contain
// (renamed/deleted output key, reordered step). Covers step_<id>.* mapping drift
// — top-level input sources resolve from the run's immutable inputs.
export function preflightRegenerate(args: {
  currentSteps: StepLike[];
  snapshot: StepResult[];
  targetStepId: string;
  rerunDownstream: boolean;
}): PreflightResult {
  const { currentSteps, snapshot, targetStepId, rerunDownstream } = args;

  const targetSnapshotIndex = snapshot.findIndex((r) => r.stepId === targetStepId);
  if (targetSnapshotIndex === -1) {
    return { ok: false, code: 404, reason: "That step is not part of this run." };
  }

  const targetPos = currentSteps.findIndex((s) => s.stepId === targetStepId);
  if (targetPos === -1) {
    return {
      ok: false,
      code: 409,
      reason:
        "This run predates your workflow edits — that step no longer exists. Run the workflow again instead.",
    };
  }

  const snapshotByStepId = new Map(snapshot.map((r) => [r.stepId, r] as const));

  // Eligibility: every step before the target must have succeeded in this run.
  for (let i = 0; i < targetPos; i++) {
    const snap = snapshotByStepId.get(currentSteps[i].stepId);
    if (!snap || snap.status !== "success") {
      return {
        ok: false,
        code: 409,
        reason:
          "An earlier step didn't complete successfully in this run. Run the workflow again instead.",
      };
    }
  }

  // Drift guard: simulate context key availability across the steps that run.
  const lastPos = rerunDownstream ? currentSteps.length - 1 : targetPos;
  const available = new Set<string>();
  const register = (stepId: string) => {
    const snap = snapshotByStepId.get(stepId);
    if (snap) {
      for (const k of Object.keys(snap.outputs)) available.add(`step_${stepId}.${k}`);
    }
    available.add(`step_${stepId}.result`);
  };
  for (let i = 0; i < targetPos; i++) register(currentSteps[i].stepId);

  for (let i = targetPos; i <= lastPos; i++) {
    const mappings = (currentSteps[i].inputMappings ?? {}) as Record<string, string>;
    for (const source of Object.values(mappings)) {
      if (!source || typeof source !== "string" || !source.startsWith("step_")) continue;
      if (!available.has(source)) {
        return {
          ok: false,
          code: 409,
          reason:
            "This run predates your workflow edits — a step now depends on output that isn't in the saved run. Run the workflow again instead.",
        };
      }
    }
    register(currentSteps[i].stepId);
  }

  const stepsToRun: number[] = [];
  for (let i = targetPos; i <= lastPos; i++) stepsToRun.push(i);
  return { ok: true, targetPos, targetSnapshotIndex, stepsToRun };
}

export type RegenEvent =
  | { type: "step_start"; stepIndex: number; skillName: string }
  | { type: "step_result"; stepIndex: number; result: StepResult }
  | { type: "step_error"; stepIndex: number; error: string }
  | { type: "stale"; stepIndexes: number[] }
  | { type: "done"; status: RunStatus }
  | { type: "error"; error: string };

// --- Streaming execution + amend --------------------------------------------
// Drives executeStep from the target step onward, amending the run's snapshot in
// place. Overwrite-only-on-success protects a kept-good output from a failed
// retry; a failed-resume appends steps that never existed; a mid-stream client
// disconnect still persists what completed (finally). Yields SSE events the Run
// tab maps to step cards.
export async function* regenerateStream(args: {
  workflowId: string;
  runId: string;
  userId: string;
  currentSteps: (typeof workflowStep.$inferSelect)[];
  run: RunDetail;
  targetStepId: string;
  feedback?: string;
  rerunDownstream: boolean;
  overrideModel?: string;
  preflight: Extract<PreflightResult, { ok: true }>;
}): AsyncGenerator<RegenEvent> {
  const {
    workflowId,
    runId,
    currentSteps,
    run,
    targetStepId,
    feedback,
    rerunDownstream,
    overrideModel,
    preflight,
  } = args;

  const enabledRules = await getEnabledRules(args.userId);
  const rulesBlock = formatRulesForInjection(enabledRules);

  const snapshot = run.stepResults;
  const amended: StepResult[] = snapshot.map((r) => ({ ...r }));
  const snapshotIndexByStepId = new Map(snapshot.map((r, i) => [r.stepId, i] as const));

  const prefix = currentSteps
    .slice(0, preflight.targetPos)
    .map((s) => snapshot[snapshotIndexByStepId.get(s.stepId)!]);
  const context = rebuildContext(run.inputs, prefix);

  // Feedback is applied to the TARGET step only; downstream steps re-run with
  // their normal config purely for coherence.
  const targetPrior = snapshot[preflight.targetSnapshotIndex]?.outputs ?? {};
  const priorText = Object.values(targetPrior)[0] ?? "";
  const feedbackAddendum = feedback
    ? [
        priorText ? `The previous output was:\n\n${priorText}` : null,
        `The user asked to improve this step. Their feedback:\n\n${feedback}`,
        "Regenerate this step's output, addressing the feedback.",
      ]
        .filter(Boolean)
        .join("\n\n")
    : undefined;

  const computeStatus = (): RunStatus =>
    amended.every((r) => r.status === "success") ? "completed" : "failed";
  let persisted = false;

  try {
    let hadError = false;

    for (const i of preflight.stepsToRun) {
      const step = currentSteps[i];
      const isTarget = step.stepId === targetStepId;
      const snapIdx = snapshotIndexByStepId.get(step.stepId);
      const uiIndex = snapIdx ?? amended.length;

      const skillName = await getSkillName(step.skillId);
      yield { type: "step_start", stepIndex: uiIndex, skillName };

      const { result, contextPatch } = await executeStep(step, context, rulesBlock, {
        modelOverride: isTarget ? overrideModel : undefined,
        feedbackAddendum: isTarget ? feedbackAddendum : undefined,
      });

      if (result.status === "error") {
        // Overwrite-only-on-success: the prior good output is left untouched.
        yield {
          type: "step_error",
          stepIndex: uiIndex,
          error: result.error ?? "Regeneration failed",
        };
        hadError = true;
        break;
      }

      Object.assign(context, contextPatch);
      const prior = snapIdx !== undefined ? snapshot[snapIdx].outputs : undefined;
      const amendedResult: StepResult = {
        ...result,
        source: "regenerate",
        regeneratedAt: new Date().toISOString(),
        ...(isTarget && feedback ? { feedback } : {}),
        ...(prior ? { replacedOutput: prior } : {}),
        isStale: false,
      };
      if (snapIdx !== undefined) amended[snapIdx] = amendedResult;
      else amended.push(amendedResult);
      yield { type: "step_result", stepIndex: uiIndex, result: amendedResult };
    }

    // Non-cascading regenerate of a middle step leaves downstream outputs derived
    // from the OLD output — mark them stale so the run never silently lies.
    if (!rerunDownstream && !hadError) {
      const staleIdx: number[] = [];
      for (let j = preflight.targetSnapshotIndex + 1; j < amended.length; j++) {
        if (amended[j].status === "success") {
          amended[j] = { ...amended[j], isStale: true };
          staleIdx.push(j);
        }
      }
      if (staleIdx.length > 0) yield { type: "stale", stepIndexes: staleIdx };
    }

    const status = computeStatus();
    const rows = await amendRun({ runId, workflowId, stepResults: amended, status });
    persisted = true;
    if (rows === 0) {
      yield {
        type: "error",
        error: "This run was removed from history while regenerating. Run the workflow again instead.",
      };
      return;
    }
    yield { type: "done", status };
  } finally {
    if (!persisted) {
      // Client disconnected mid-regenerate: persist what completed so a billed
      // result is never lost. Best-effort — we can no longer yield to the client.
      try {
        await amendRun({ runId, workflowId, stepResults: amended, status: computeStatus() });
      } catch {
        /* swallow — nothing we can surface after the stream is gone */
      }
    }
  }
}
