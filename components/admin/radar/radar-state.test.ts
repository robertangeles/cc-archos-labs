import { describe, expect, it } from "vitest";
import { applyLabelLocally, findRow, nextDecision, pendingLabel } from "./radar-state";
import type { RadarPageData, RadarRow } from "../../../lib/news-radar/radar-page-types";

// The pure part of the label control (DES-D6): which decision a press means, and
// how the page's counts and rows move when a label changes. The component only
// wires these to fetch.

const row = (over: Partial<RadarRow> = {}): RadarRow => ({
  id: "r1", title: "T", summary: "", category: "ai", sourceUrl: "https://huggingnews.com/ai/x",
  sourceHost: "huggingnews.com", publishedAt: "2026-10-26T03:00:00Z", day: "2026-10-26", status: "scored",
  cohortVersion: 1, eligible: true, audienceFit: { score: 2.5, confidence: 0.9 }, noveltyDistance: 0.5,
  label: null, latestLabelId: null, ...over,
});

const data = (rows: RadarRow[], more: RadarRow[] = []): RadarPageData => ({
  view: "to-label",
  cohort: { version: 1, startedAt: "2026-10-26T00:00:00Z", isActive: true },
  cohorts: [],
  counts: { toLabel: 3, shortlisted: 5, kept: 1, skipped: 2, all: 9 },
  days: [{ day: "2026-10-26", rows, more }],
  page: null,
  progress: { todayLabelled: 1, todayTotal: 4, cohortLabelled: 3, cohortTarget: 50, validDays: 2, targetDays: 7, gateReady: false },
  status: { state: "healthy", lastCheckAt: null, failureClass: null, failedSlotAt: null, nextCheckAt: "2026-10-26T05:00:00Z" },
  generatedAt: "2026-10-26T04:00:00Z",
});

describe("nextDecision", () => {
  it("labels an unlabelled item with the pressed button", () => {
    expect(nextDecision(null, "keep")).toBe("keep");
    expect(nextDecision(null, "skip")).toBe("skip");
  });
  it("switches when the other button is pressed", () => {
    expect(nextDecision({ id: "a", decision: "keep" }, "skip")).toBe("skip");
    expect(nextDecision({ id: "a", decision: "skip" }, "keep")).toBe("keep");
  });
  it("clears when the selected button is pressed again", () => {
    expect(nextDecision({ id: "a", decision: "keep" }, "keep")).toBe("clear");
    expect(nextDecision({ id: "a", decision: "skip" }, "skip")).toBe("clear");
  });
});

describe("pendingLabel", () => {
  it("is an optimistic label for keep/skip and none for clear", () => {
    expect(pendingLabel("keep")).toEqual({ id: "pending", decision: "keep" });
    expect(pendingLabel("clear")).toBeNull();
  });
});

describe("applyLabelLocally", () => {
  it("moves an unlabelled item to Kept: counts and today's progress", () => {
    const next = applyLabelLocally(data([row()]), "r1", { id: "l1", decision: "keep" }, "l1", "2026-10-26");
    expect(next.counts).toMatchObject({ toLabel: 2, kept: 2, skipped: 2, shortlisted: 5, all: 9 });
    expect(next.progress).toMatchObject({ todayLabelled: 2, cohortLabelled: 4 });
    expect(findRow(next, "r1")).toMatchObject({ label: { id: "l1", decision: "keep" }, latestLabelId: "l1" });
  });

  it("moves Keep to Skip between the two buckets only", () => {
    const start = data([row({ label: { id: "l1", decision: "keep" }, latestLabelId: "l1" })]);
    const next = applyLabelLocally(start, "r1", { id: "l2", decision: "skip" }, "l2", "2026-10-26");
    expect(next.counts).toMatchObject({ toLabel: 3, kept: 0, skipped: 3 });
    expect(next.progress.todayLabelled).toBe(1);
  });

  it("returns a cleared item to To label and keeps the clear row's id for the next stale check", () => {
    const start = data([row({ label: { id: "l1", decision: "skip" }, latestLabelId: "l1" })]);
    const next = applyLabelLocally(start, "r1", null, "l3", "2026-10-26");
    expect(next.counts).toMatchObject({ toLabel: 4, skipped: 1 });
    expect(next.progress).toMatchObject({ todayLabelled: 0, cohortLabelled: 2 });
    expect(findRow(next, "r1")).toMatchObject({ label: null, latestLabelId: "l3" });
  });

  it("does not touch today's progress for an item from another day", () => {
    const next = applyLabelLocally(data([row({ day: "2026-10-24" })]), "r1", { id: "l1", decision: "keep" }, "l1", "2026-10-26");
    expect(next.progress.todayLabelled).toBe(1);
    expect(next.progress.cohortLabelled).toBe(4);
  });

  it("updates a row hidden behind Show more, and never mutates its input", () => {
    const start = data([], [row({ id: "r9" })]);
    const frozen = JSON.stringify(start);
    const next = applyLabelLocally(start, "r9", { id: "l1", decision: "keep" }, "l1", "2026-10-26");
    expect(JSON.stringify(start)).toBe(frozen);
    expect(findRow(next, "r9")?.label?.decision).toBe("keep");
  });

  it("is a no-op for an unknown id", () => {
    const start = data([row()]);
    expect(applyLabelLocally(start, "nope", { id: "x", decision: "keep" }, "x", "2026-10-26")).toEqual(start);
  });
});
