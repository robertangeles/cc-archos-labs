import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema";
import type { StepResult } from "./types";

// Real-DB test of the amend persistence guarantees (F1 / evict-race / scoping).
// The eng review asked for a real Postgres engine here because a mocked getDb
// gives false green on exactly the UPDATE...WHERE rows-affected behaviour these
// guarantees rest on. We use the same engine as tests/helpers/org-test-db.ts
// (PGlite) but with an isolated minimal table — drizzle/0020 (which creates
// workflow_execution_run) ALTERs an earlier `skill` table, so it can't be
// dropped into the org harness without the full migration chain.
let client: PGlite;
let db: ReturnType<typeof drizzle>;

vi.mock("../db", () => ({ getDb: () => db }));

import { amendRun, getRun } from "./runs";
import { workflowExecutionRun } from "../db/schema";

function sr(stepId: string, result: string): StepResult {
  return {
    stepId,
    skillId: "raw",
    outputs: { result },
    usage: { inputTokens: 0, outputTokens: 0 },
    model: "m",
    durationMs: 1,
    status: "success",
  };
}

const WID = "11111111-1111-1111-1111-111111111111";
const OTHER_WID = "22222222-2222-2222-2222-222222222222";
const UID = "44444444-4444-4444-4444-444444444444";
const OTHER_UID = "55555555-5555-5555-5555-555555555555";

beforeEach(async () => {
  client = new PGlite();
  await client.query(`
    CREATE TABLE "workflow_execution_run" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "workflow_id" uuid NOT NULL,
      "user_id" uuid,
      "inputs" jsonb NOT NULL,
      "step_results" jsonb NOT NULL,
      "status" text NOT NULL,
      "total_duration_ms" integer,
      "created_at" timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  db = drizzle(client, { schema }) as never;
});

afterEach(async () => {
  await client.close();
});

async function seedRun(steps: StepResult[], status = "completed"): Promise<string> {
  const [row] = await db
    .insert(workflowExecutionRun)
    .values({
      workflowId: WID,
      userId: UID,
      inputs: {},
      stepResults: steps,
      status,
      totalDurationMs: 1,
    })
    .returning({ id: workflowExecutionRun.id });
  return row.id as string;
}

describe("amendRun (real pglite)", () => {
  it("overwrites step_results + status and returns 1 row affected", async () => {
    const id = await seedRun([sr("a", "OLD")]);
    const n = await amendRun({
      runId: id,
      workflowId: WID,
      userId: UID,
      stepResults: [sr("a", "NEW")],
      status: "completed",
    });
    expect(n).toBe(1);
    const after = await getRun(id, WID);
    expect(after?.stepResults[0].outputs.result).toBe("NEW");
  });

  it("returns 0 when the run no longer exists (evicted mid-amend) — the phantom-success guard", async () => {
    const n = await amendRun({
      runId: "33333333-3333-3333-3333-333333333333",
      workflowId: WID,
      userId: UID,
      stepResults: [],
      status: "failed",
    });
    expect(n).toBe(0);
  });

  it("is scoped to (id, workflowId): a wrong workflowId updates nothing and leaves the output intact", async () => {
    const id = await seedRun([sr("a", "OLD")]);
    const n = await amendRun({
      runId: id,
      workflowId: OTHER_WID,
      userId: UID,
      stepResults: [sr("a", "HACK")],
      status: "completed",
    });
    expect(n).toBe(0);
    const after = await getRun(id, WID);
    expect(after?.stepResults[0].outputs.result).toBe("OLD");
  });

  it("is scoped to userId: a wrong userId updates nothing and leaves the output intact", async () => {
    const id = await seedRun([sr("a", "OLD")]);
    const n = await amendRun({
      runId: id,
      workflowId: WID,
      userId: OTHER_UID,
      stepResults: [sr("a", "HACK")],
      status: "completed",
    });
    expect(n).toBe(0);
    const after = await getRun(id, WID);
    expect(after?.stepResults[0].outputs.result).toBe("OLD");
  });
});
