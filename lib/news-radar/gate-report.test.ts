import { describe, expect, it } from "vitest";
import { buildGateReport } from "./gate-report";
import type { CohortSnapshot } from "./queries";
import type { Candidate, Label, Tick } from "./decide";

// The Release 1 gate report: numbers per explicit cohort, the missed-tick rule,
// and the Kept list for the human "would I write this" check. Pure: the script
// only loads the snapshot and prints.

const CUT = { audienceFit: 2, confidence: 0.6, minNoveltyDistance: 0.3, dailyCap: 3 };

// Melbourne is UTC+11 in this window (daylight saving started 2026-10-04).
const cand = (id: string, publishedAt: string, fit = 2.5): Candidate => ({
  id, publishedAt: new Date(publishedAt), audienceFit: { score: fit, confidence: 0.9 }, noveltyDistance: 0.5,
});

function slots(day: string): Tick[] {
  // The 2-hour UTC slots are on even UTC hours, so at UTC+11 a Melbourne day runs
  // 14:00Z the day before to 12:00Z, which is 12 slots.
  const base = new Date(`${day}T00:00:00Z`).getTime() - 10 * 3_600_000;
  return Array.from({ length: 12 }, (_, i) => ({ slotAt: new Date(base + i * 2 * 3_600_000), outcome: "ok" as const }));
}

function snap(over: Partial<CohortSnapshot> = {}): CohortSnapshot {
  return {
    version: 3,
    startedAt: new Date("2026-10-20T01:00:00Z"),
    cutoffs: CUT,
    candidates: [],
    titles: new Map(),
    labels: [],
    ticks: [],
    ...over,
  };
}

const NOW = new Date("2026-10-22T05:00:00Z"); // 16:00 Thu 22 Oct, Melbourne

describe("buildGateReport", () => {
  it("counts a labelled population, keep rate, and lists the Kept titles for the human check", () => {
    const candidates = [cand("a", "2026-10-20T03:00:00Z"), cand("b", "2026-10-20T04:00:00Z"), cand("c", "2026-10-21T03:00:00Z")];
    const labels: Label[] = [
      { candidateId: "a", sequence: 1, decision: "keep" },
      { candidateId: "b", sequence: 2, decision: "skip" },
      { candidateId: "c", sequence: 3, decision: "keep" },
    ];
    const titles = new Map([["a", "Audit rules for bank AI"], ["b", "A skipped item"], ["c", "Healthcare model registry"]]);
    const r = buildGateReport(snap({ candidates, labels, titles }), NOW);

    expect(r.counts).toMatchObject({ eligibleCount: 3, labelledEligible: 3, kept: 2, skipped: 1, keepRate: 2 / 3 });
    expect(r.text).toContain("Cohort v3");
    expect(r.text).toContain("Keep rate: 66.7%");
    expect(r.text).toContain("Audit rules for bank AI");
    expect(r.text).toContain("Healthcare model registry");
    expect(r.text).not.toContain("A skipped item");
    expect(r.text).toMatch(/Rob would personally write/);
  });

  it("latest label wins: a relabel changes the count, not the population", () => {
    const candidates = [cand("a", "2026-10-20T03:00:00Z")];
    const labels: Label[] = [
      { candidateId: "a", sequence: 1, decision: "keep" },
      { candidateId: "a", sequence: 2, decision: "skip" },
    ];
    expect(buildGateReport(snap({ candidates, labels }), NOW).counts).toMatchObject({ labelledEligible: 1, kept: 0, skipped: 1 });
  });

  it("excludes a day with a missed slot, so the window extends", () => {
    const ticks = [...slots("2026-10-20"), ...slots("2026-10-21").slice(1)]; // 21 Oct misses its first slot
    const r = buildGateReport(snap({ ticks }), NOW);
    expect(r.counts.validDays).toBe(1);
    expect(r.counts.missedDays).toEqual(expect.arrayContaining(["2026-10-21", "2026-10-22"]));
    expect(r.text).toContain("2026-10-21");
    expect(r.text).toMatch(/Valid days: 1 of 7/);
  });

  it("reports a Kept item that is not eligible separately and keeps it out of the rate", () => {
    const candidates = [cand("a", "2026-10-20T03:00:00Z"), cand("weak", "2026-10-20T04:00:00Z", 0.4)];
    const labels: Label[] = [
      { candidateId: "a", sequence: 1, decision: "skip" },
      { candidateId: "weak", sequence: 2, decision: "keep" },
    ];
    const r = buildGateReport(snap({ candidates, labels, titles: new Map([["weak", "Weak but kept"]]) }), NOW);
    expect(r.counts).toMatchObject({ labelledEligible: 1, kept: 0, keptNotEligible: 1 });
    expect(r.text).toContain("Kept but not eligible: 1");
  });

  it("says plainly when no gate criterion is met yet and when the measured ones are", () => {
    expect(buildGateReport(snap(), NOW).text).toContain("Measured criteria: NOT MET");
    const candidates = Array.from({ length: 50 }, (_, i) => cand(`c${i}`, "2026-10-20T03:00:00Z"));
    const labels: Label[] = candidates.map((c, i) => ({ candidateId: c.id, sequence: i + 1, decision: i < 30 ? "keep" : "skip" }));
    const days = ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"];
    const ticks = days.flatMap((d) => slots(d));
    const r = buildGateReport(
      snap({ startedAt: new Date("2026-10-14T13:00:00Z"), candidates, labels, ticks }),
      new Date("2026-10-22T05:00:00Z"),
    );
    expect(r.counts.measuredCriteriaMet).toBe(true);
    expect(r.text).toContain("Measured criteria: MET");
    expect(r.text).toContain("human check");
  });

  it("handles a cohort that never started", () => {
    const r = buildGateReport(snap({ startedAt: null }), NOW);
    expect(r.days).toEqual([]);
    expect(r.text).toContain("not started");
  });
});
