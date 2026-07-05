import { describe, it, expect } from "vitest";
import { rebuildContext, preflightRegenerate } from "./regenerate";
import type { StepResult } from "./types";

function sr(
  stepId: string,
  status: "success" | "error" = "success",
  outputs: Record<string, string> = { result: "x" },
): StepResult {
  return {
    stepId,
    skillId: "raw",
    outputs,
    usage: { inputTokens: 0, outputTokens: 0 },
    model: "m",
    durationMs: 1,
    status,
  };
}

function step(stepId: string, inputMappings: Record<string, string> = {}) {
  return { stepId, inputMappings };
}

describe("rebuildContext", () => {
  it("seeds inputs and adds both key forms for each successful prior step", () => {
    const ctx = rebuildContext({ topic: "spring" }, [sr("a", "success", { summary: "S" })]);
    expect(ctx).toEqual({
      topic: "spring",
      "step_a.summary": "S",
      "step_a.result": "S",
    });
  });

  it("skips prior steps that failed (no context keys for them)", () => {
    const ctx = rebuildContext({ topic: "t" }, [sr("a", "error", {})]);
    expect(ctx).toEqual({ topic: "t" });
  });
});

describe("preflightRegenerate", () => {
  const steps = [step("a"), step("b", { in: "step_a.result" })];
  const snapshot = [sr("a"), sr("b")];

  it("allows a single-step regenerate and returns just the target", () => {
    const r = preflightRegenerate({ currentSteps: steps, snapshot, targetStepId: "b", rerunDownstream: false });
    expect(r).toEqual({ ok: true, targetPos: 1, targetSnapshotIndex: 1, stepsToRun: [1] });
  });

  it("returns the full downstream range when cascading", () => {
    const r = preflightRegenerate({ currentSteps: steps, snapshot, targetStepId: "a", rerunDownstream: true });
    expect(r).toMatchObject({ ok: true, targetPos: 0, stepsToRun: [0, 1] });
  });

  it("404s when the target step is not in the run snapshot", () => {
    const r = preflightRegenerate({ currentSteps: steps, snapshot, targetStepId: "z", rerunDownstream: false });
    expect(r).toEqual({ ok: false, code: 404, reason: expect.any(String) });
  });

  it("409s when the target step was deleted from the workflow (drift)", () => {
    const r = preflightRegenerate({
      currentSteps: [step("a")],
      snapshot: [sr("a"), sr("z")],
      targetStepId: "z",
      rerunDownstream: false,
    });
    expect(r).toMatchObject({ ok: false, code: 409 });
  });

  it("409s when a prefix step did not succeed in this run", () => {
    const r = preflightRegenerate({
      currentSteps: steps,
      snapshot: [sr("a", "error", {}), sr("b")],
      targetStepId: "b",
      rerunDownstream: false,
    });
    expect(r).toMatchObject({ ok: false, code: 409 });
  });

  it("409s on output-key drift: a mapping references a renamed key not in the snapshot", () => {
    const r = preflightRegenerate({
      currentSteps: [step("a"), step("b", { in: "step_a.newkey" })],
      snapshot: [sr("a", "success", { oldkey: "v" }), sr("b")],
      targetStepId: "b",
      rerunDownstream: false,
    });
    expect(r).toMatchObject({ ok: false, code: 409 });
  });

  it("allows a mapping that resolves to the always-present .result key", () => {
    const r = preflightRegenerate({
      currentSteps: [step("a"), step("b", { in: "step_a.result" })],
      snapshot: [sr("a", "success", { oldkey: "v" }), sr("b")],
      targetStepId: "b",
      rerunDownstream: false,
    });
    expect(r).toMatchObject({ ok: true });
  });

  it("resuming the failed target itself is allowed (only the prefix must succeed)", () => {
    const r = preflightRegenerate({
      currentSteps: steps,
      snapshot: [sr("a"), sr("b", "error", {})],
      targetStepId: "b",
      rerunDownstream: false,
    });
    expect(r).toMatchObject({ ok: true, targetPos: 1 });
  });
});
