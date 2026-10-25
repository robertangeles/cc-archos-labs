import type {
  LabelDecision,
  RadarCounts,
  RadarLabel,
  RadarPageData,
  RadarRow,
} from "../../../lib/news-radar/radar-page-types";

// The pure part of the label control (DES-D6): which decision a press means, and
// how the page's rows, counts and progress move when a label changes. The
// component only wires these to fetch.

/** Pressing the selected button clears; pressing the other switches. */
export function nextDecision(current: RadarLabel | null, pressed: "keep" | "skip"): LabelDecision {
  return current?.decision === pressed ? "clear" : pressed;
}

/** The label shown while a save is in flight. Replaced by the server's row id. */
export function pendingLabel(decision: LabelDecision): RadarLabel | null {
  return decision === "clear" ? null : { id: "pending", decision };
}

export function findRow(data: RadarPageData, id: string): RadarRow | undefined {
  for (const d of data.days) {
    const hit = d.rows.find((r) => r.id === id) ?? d.more.find((r) => r.id === id);
    if (hit) return hit;
  }
  return undefined;
}

type Bucket = "toLabel" | "kept" | "skipped";
const bucket = (l: RadarLabel | null): Bucket => (l === null ? "toLabel" : l.decision === "keep" ? "kept" : "skipped");

function moveCounts(counts: RadarCounts, from: RadarLabel | null, to: RadarLabel | null): RadarCounts {
  const a = bucket(from);
  const b = bucket(to);
  return a === b ? counts : { ...counts, [a]: counts[a] - 1, [b]: counts[b] + 1 };
}

/**
 * Set one item's label (and the id of its newest label row) and move the counts
 * and progress with it. The item keeps its place on the page: a just-labelled
 * row stays until reload (DES-D4). `today` is the current Melbourne day.
 */
export function applyLabelLocally(
  data: RadarPageData,
  id: string,
  label: RadarLabel | null,
  latestLabelId: string | null,
  today: string,
): RadarPageData {
  const before = findRow(data, id);
  if (!before) return data;

  const patch = (r: RadarRow): RadarRow => (r.id === id ? { ...r, label, latestLabelId } : r);
  const wasLabelled = before.label !== null;
  const isLabelled = label !== null;
  const delta = Number(isLabelled) - Number(wasLabelled);

  return {
    ...data,
    days: data.days.map((d) => ({ ...d, rows: d.rows.map(patch), more: d.more.map(patch) })),
    counts: moveCounts(data.counts, before.label, label),
    progress: {
      ...data.progress,
      todayLabelled: data.progress.todayLabelled + (before.day === today ? delta : 0),
      cohortLabelled: data.progress.cohortLabelled + delta,
    },
  };
}
