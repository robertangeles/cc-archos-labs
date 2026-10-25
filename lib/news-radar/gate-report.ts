import {
  GATE_HUMAN_CHECK,
  GATE_MIN_DAYS,
  GATE_MIN_KEEP_RATE,
  GATE_MIN_LABELLED,
  currentDecisions,
  gateCounts,
  melbourneDay,
  type GateCounts,
} from "./decide";
import type { CohortSnapshot } from "./queries";

// The Release 1 gate report for ONE rubric version (plan CEO D11, ENG-D9 to D11).
// Pure: scripts/radar-gate-report.mjs loads the snapshot and prints this.
//
// The window is every Melbourne day from the cohort's first score to today. A day
// with any missed 2-hour slot is excluded, so today (slots still to come) and a
// partial first day count as missed until they are complete: the window extends.

export interface GateReport {
  counts: GateCounts;
  /** The Melbourne days the window covers, oldest first. */
  days: string[];
  text: string;
}

function windowDays(startedAt: Date | null, now: Date): string[] {
  if (!startedAt) return [];
  const last = melbourneDay(now);
  const days: string[] = [];
  for (let t = new Date(`${melbourneDay(startedAt)}T12:00:00Z`).getTime(); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    days.push(day);
    if (day >= last || days.length > 400) return days;
  }
}

const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);
const mark = (ok: boolean) => (ok ? "yes" : "no");

export function buildGateReport(snap: CohortSnapshot, now: Date): GateReport {
  const days = windowDays(snap.startedAt, now);
  const counts = gateCounts({
    candidates: snap.candidates,
    cutoffs: snap.cutoffs,
    labels: snap.labels,
    ticks: snap.ticks,
    days,
  });

  const lines: string[] = [];
  lines.push(`News radar gate report: Cohort v${snap.version}`);
  lines.push(
    snap.startedAt
      ? `Window: ${days[0]} to ${days[days.length - 1]} (Melbourne days)`
      : "Window: this cohort has not started (no score rows yet).",
  );
  const c = snap.cutoffs;
  lines.push(
    `Cut-offs (frozen for this version): audience fit >= ${c.audienceFit}, confidence >= ${c.confidence}, ` +
      `novelty distance >= ${c.minNoveltyDistance}, daily display cap ${c.dailyCap}`,
  );
  lines.push("");
  lines.push(`Eligible items: ${counts.eligibleCount}`);
  lines.push(`Labelled eligible items: ${counts.labelledEligible} (kept ${counts.kept}, skipped ${counts.skipped})`);
  lines.push(`Keep rate: ${pct(counts.keepRate)}`);
  lines.push(`Kept but not eligible: ${counts.keptNotEligible} (reported apart, not in the rate)`);
  lines.push(`Valid days: ${counts.validDays} of ${GATE_MIN_DAYS}`);
  if (counts.missedDays.length) lines.push(`Excluded days (a slot was missed or is still to come): ${counts.missedDays.join(", ")}`);
  lines.push("");
  lines.push(`>= ${GATE_MIN_DAYS} valid days: ${mark(counts.criteria.days)}`);
  lines.push(`>= ${GATE_MIN_LABELLED} labelled eligible items: ${mark(counts.criteria.labelled)}`);
  lines.push(`Keep rate >= ${GATE_MIN_KEEP_RATE * 100}%: ${mark(counts.criteria.keepRate)}`);
  lines.push(`Measured criteria: ${counts.measuredCriteriaMet ? "MET" : "NOT MET"}`);
  lines.push("");
  lines.push(`Still a human check: ${GATE_HUMAN_CHECK}`);

  const kept = [...currentDecisions(snap.labels)]
    .filter(([, decision]) => decision === "keep")
    .map(([id]) => snap.titles.get(id) ?? id)
    .sort();
  if (kept.length) {
    lines.push("Kept titles:");
    for (const t of kept) lines.push(`  - ${t}`);
  }

  return { counts, days, text: lines.join("\n") };
}
