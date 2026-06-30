import { describe, it, expect } from "vitest";
import { runsToEvict, MAX_RUNS_PER_WORKFLOW } from "./runs";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `run-${i}`);

describe("runsToEvict", () => {
  it("evicts nothing when under the cap", () => {
    expect(runsToEvict(ids(5))).toEqual([]);
  });

  it("evicts nothing when exactly at the cap", () => {
    expect(runsToEvict(ids(MAX_RUNS_PER_WORKFLOW))).toEqual([]);
  });

  it("evicts the oldest run when one over the cap", () => {
    // Input is newest-first, so the surplus is the tail (oldest).
    const list = ids(MAX_RUNS_PER_WORKFLOW + 1);
    expect(runsToEvict(list)).toEqual([`run-${MAX_RUNS_PER_WORKFLOW}`]);
  });

  it("evicts all runs beyond the most recent cap", () => {
    const list = ids(MAX_RUNS_PER_WORKFLOW + 5);
    const evicted = runsToEvict(list);
    expect(evicted).toHaveLength(5);
    // Keeps exactly the cap.
    expect(list.length - evicted.length).toBe(MAX_RUNS_PER_WORKFLOW);
    // The kept ids are the newest (first `cap`), evicted are the rest.
    expect(evicted).toEqual(list.slice(MAX_RUNS_PER_WORKFLOW));
  });

  it("respects a custom max", () => {
    expect(runsToEvict(ids(4), 2)).toEqual(["run-2", "run-3"]);
  });

  it("the retention cap is 22", () => {
    expect(MAX_RUNS_PER_WORKFLOW).toBe(22);
  });
});
