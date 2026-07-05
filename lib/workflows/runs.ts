import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { workflowExecutionRun } from "../db/schema";
import type { StepResult } from "./types";

// How many runs to retain per workflow. Older runs are pruned on each new run.
export const MAX_RUNS_PER_WORKFLOW = 22;

export type RunStatus = "completed" | "failed" | "partial";

// Lightweight row for the history list — excludes the heavy stepResults blob.
export interface RunSummary {
  id: string;
  status: string;
  totalDurationMs: number | null;
  createdAt: Date;
  inputs: Record<string, string>;
  stepCount: number;
}

// Full snapshot of a single past run, including every step's output.
export interface RunDetail extends RunSummary {
  stepResults: StepResult[];
}

// Pure decision: given run ids ordered newest-first, return the ids that fall
// outside the retention window and should be deleted. Kept pure so the cap
// logic is unit-testable without a database.
export function runsToEvict(
  idsNewestFirst: string[],
  max: number = MAX_RUNS_PER_WORKFLOW,
): string[] {
  return idsNewestFirst.slice(max);
}

// Insert a completed run snapshot, then prune the workflow back to the most
// recent MAX_RUNS_PER_WORKFLOW. Returns the new run id (or null on failure).
export async function persistRun(args: {
  workflowId: string;
  userId: string;
  inputs: Record<string, string>;
  stepResults: StepResult[];
  status: RunStatus;
  totalDurationMs: number;
}): Promise<string | null> {
  const db = getDb();

  const [run] = await db
    .insert(workflowExecutionRun)
    .values({
      workflowId: args.workflowId,
      userId: args.userId,
      inputs: args.inputs,
      stepResults: args.stepResults,
      status: args.status,
      totalDurationMs: args.totalDurationMs,
    })
    .returning({ id: workflowExecutionRun.id });

  await pruneRuns(args.workflowId);

  return run?.id ?? null;
}

// Overwrite an existing run's step_results + status in place (a per-step
// Regenerate amend). Scoped to (id, workflowId) so it can never touch another
// workflow's run. Returns the number of rows updated: 0 means the run no longer
// exists — it was pruned past the 22-run cap between snapshot read and amend, so
// the caller must surface an error rather than report a phantom success (the
// LLM was already billed). Does NOT prune; an amend never grows the run count.
export async function amendRun(args: {
  runId: string;
  workflowId: string;
  stepResults: StepResult[];
  status: RunStatus;
}): Promise<number> {
  const db = getDb();

  const updated = await db
    .update(workflowExecutionRun)
    .set({ stepResults: args.stepResults, status: args.status })
    .where(
      and(
        eq(workflowExecutionRun.id, args.runId),
        eq(workflowExecutionRun.workflowId, args.workflowId),
      ),
    )
    .returning({ id: workflowExecutionRun.id });

  return updated.length;
}

// Delete runs beyond the retention window for one workflow. Cascades to
// workflow_execution_log via the run_id foreign key.
async function pruneRuns(workflowId: string): Promise<void> {
  const db = getDb();

  const rows = await db
    .select({ id: workflowExecutionRun.id })
    .from(workflowExecutionRun)
    .where(eq(workflowExecutionRun.workflowId, workflowId))
    .orderBy(desc(workflowExecutionRun.createdAt));

  const evict = runsToEvict(rows.map((r) => r.id));
  if (evict.length === 0) return;

  await db
    .delete(workflowExecutionRun)
    .where(
      and(
        eq(workflowExecutionRun.workflowId, workflowId),
        inArray(workflowExecutionRun.id, evict),
      ),
    );
}

// List run summaries for a workflow, newest first. Ownership is enforced by the
// caller (the API route verifies the workflow belongs to the user first).
export async function listRuns(workflowId: string): Promise<RunSummary[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: workflowExecutionRun.id,
      status: workflowExecutionRun.status,
      totalDurationMs: workflowExecutionRun.totalDurationMs,
      createdAt: workflowExecutionRun.createdAt,
      inputs: workflowExecutionRun.inputs,
      stepCount: sql<number>`jsonb_array_length(${workflowExecutionRun.stepResults})`,
    })
    .from(workflowExecutionRun)
    .where(eq(workflowExecutionRun.workflowId, workflowId))
    .orderBy(desc(workflowExecutionRun.createdAt))
    .limit(MAX_RUNS_PER_WORKFLOW);

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    totalDurationMs: r.totalDurationMs,
    createdAt: r.createdAt,
    inputs: (r.inputs ?? {}) as Record<string, string>,
    stepCount: Number(r.stepCount ?? 0),
  }));
}

// Full snapshot of a single run, including step outputs. Returns null if the
// run does not belong to the given workflow.
export async function getRun(
  runId: string,
  workflowId: string,
): Promise<RunDetail | null> {
  const db = getDb();

  const [row] = await db
    .select({
      id: workflowExecutionRun.id,
      status: workflowExecutionRun.status,
      totalDurationMs: workflowExecutionRun.totalDurationMs,
      createdAt: workflowExecutionRun.createdAt,
      inputs: workflowExecutionRun.inputs,
      stepResults: workflowExecutionRun.stepResults,
    })
    .from(workflowExecutionRun)
    .where(
      and(
        eq(workflowExecutionRun.id, runId),
        eq(workflowExecutionRun.workflowId, workflowId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const stepResults = (row.stepResults ?? []) as StepResult[];

  return {
    id: row.id,
    status: row.status,
    totalDurationMs: row.totalDurationMs,
    createdAt: row.createdAt,
    inputs: (row.inputs ?? {}) as Record<string, string>,
    stepCount: stepResults.length,
    stepResults,
  };
}
