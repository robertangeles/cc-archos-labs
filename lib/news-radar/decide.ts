// News radar decisions — pure.
//
// Everything the Radar page, the gate report script and the tick log need to
// agree on lives here: who is eligible, in what order, which Melbourne day an
// item belongs to, which days the radar missed, and what the gate counts.
// Plain data in, plain data out. No database, no network, no clock: the page
// and the gate report call the SAME functions so the list Rob sees is exactly
// the list the gate counts (ENG-D3, ENG-D9, ENG-D10, ENG-D11).
//
// Total on bad input by design: NaN, nulls, empty lists and unreadable dates
// make an item ineligible or a day missed. They never throw and never count
// in the radar's favour.

import { melbourneParts } from "../format-melbourne";

// ----------------------------------------------------------------------------
// Types — narrow, defined here so this module imports nothing from the DB
// ----------------------------------------------------------------------------

/** Frozen with the rubric version (CEO D13). Changing any value starts a new cohort. */
export interface Cutoffs {
  /** T: minimum score on the audience-fit question. */
  audienceFit: number;
  /** C: minimum confidence of that answer. */
  confidence: number;
  /** M: minimum cosine distance from the nearest published post (higher = more novel). */
  minNoveltyDistance: number;
  /** N: how many items per Melbourne day are shown first. DISPLAY only. */
  dailyCap: number;
}

/** A candidate with its scores under ONE rubric version. */
export interface Candidate {
  id: string;
  publishedAt: Date;
  audienceFit: { score: number; confidence: number } | null;
  /** null = novelty unavailable (embedding failed) = not eligible. */
  noveltyDistance: number | null;
}

/** One row of news_radar_tick. A crashed tick writes no row at all. */
export interface Tick {
  slotAt: Date;
  outcome: "ok" | "partial" | "failed" | "disabled";
}

/** `sequence` is the label table's identity column; "clear" is DES-D6 (undo a label). */
export interface Label {
  candidateId: string;
  sequence: number;
  decision: "keep" | "skip" | "clear";
}

/** The two columns of a score row that decide cohort membership. */
export interface ScoreStamp {
  rubricVersion: number;
  createdAt: Date;
}

// ----------------------------------------------------------------------------
// Gate thresholds — fixed before any data (CEO D11), never tuned from results
// ----------------------------------------------------------------------------

export const GATE_MIN_DAYS = 7;
export const GATE_MIN_LABELLED = 50;
export const GATE_MIN_KEEP_RATE = 0.5;
/** The fourth criterion is Rob's judgement. The gate report prints this; nothing here computes it. */
export const GATE_HUMAN_CHECK =
  "At least 5 Kept topics Rob would personally write: read the Kept list and confirm.";

// ----------------------------------------------------------------------------
// Eligibility and order
// ----------------------------------------------------------------------------

/** Finite and at least `min`. Infinity is garbage, not a perfect score. */
function atLeast(value: number, min: number): boolean {
  return Number.isFinite(value) && value >= min;
}

/**
 * Eligible = audience fit >= T, its confidence >= C, novelty available and >= M.
 * Depends ONLY on the item's own scores and the frozen cut-offs, so adding
 * items to a list can never remove one (R-admission). An unreadable
 * publishedAt is also ineligible: the item cannot be placed on a day.
 */
export function isEligible(c: Candidate, cutoffs: Cutoffs): boolean {
  return (
    c.audienceFit !== null &&
    atLeast(c.audienceFit.score, cutoffs.audienceFit) &&
    atLeast(c.audienceFit.confidence, cutoffs.confidence) &&
    c.noveltyDistance !== null &&
    atLeast(c.noveltyDistance, cutoffs.minNoveltyDistance) &&
    Number.isFinite(c.publishedAt.getTime())
  );
}

/**
 * Audience fit desc, confidence desc, publishedAt desc, id asc. The id
 * compare is plain code-unit order, not localeCompare, so the page and the
 * gate report cannot disagree because of a locale. Eligible items only:
 * every key is a finite number there, so the comparator is a total order.
 */
function compareEligible(a: Candidate, b: Candidate): number {
  return (
    (b.audienceFit?.score ?? 0) - (a.audienceFit?.score ?? 0) ||
    (b.audienceFit?.confidence ?? 0) - (a.audienceFit?.confidence ?? 0) ||
    b.publishedAt.getTime() - a.publishedAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The eligible items in the one deterministic order. Returns a new array. */
export function orderEligible(list: readonly Candidate[], cutoffs: Cutoffs): Candidate[] {
  return list.filter((c) => isEligible(c, cutoffs)).sort(compareEligible);
}

// ----------------------------------------------------------------------------
// Melbourne days
// ----------------------------------------------------------------------------

/**
 * The Melbourne local date (YYYY-MM-DD) of a UTC instant. Rob reads days in
 * Melbourne time, so the shortlist grouping and the missed-day rule both use
 * this, never the UTC date. Throws RangeError on an Invalid Date (Intl does);
 * isEligible keeps those out of shortlistView.
 */
export function melbourneDay(utc: Date): string {
  const p = melbourneParts(utc);
  return `${p.year}-${p.month}-${p.day}`;
}

export interface DayView {
  /** Melbourne local date, YYYY-MM-DD. */
  day: string;
  /** The first N eligible items of the day, in order. */
  shown: Candidate[];
  /** The rest, behind "show more". */
  more: Candidate[];
}

/**
 * Eligible items grouped by the Melbourne day of publishedAt, newest day
 * first. N only decides how many of a day's items are `shown`; every
 * eligible item is in `shown` or `more`, so N never changes eligibility or
 * the gate population. A cap that is not a positive number shows nothing
 * first and loses nothing.
 */
export function shortlistView(list: readonly Candidate[], cutoffs: Cutoffs): DayView[] {
  const cap = Math.max(0, Math.floor(cutoffs.dailyCap)) || 0;
  const byDay = new Map<string, Candidate[]>();
  for (const c of orderEligible(list, cutoffs)) {
    const day = melbourneDay(c.publishedAt);
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }
  return [...byDay.keys()]
    .sort()
    .reverse()
    .map((day) => {
      const items = byDay.get(day) ?? [];
      return { day, shown: items.slice(0, cap), more: items.slice(cap) };
    });
}

// ----------------------------------------------------------------------------
// Tick log — the missed-day rule (ENG-D10)
// ----------------------------------------------------------------------------

// Cron is `0 */2 * * *` in UTC. Hard-coded: the schedule is code, not config.
const SLOT_HOURS = 2;

/**
 * The UTC slot instants whose Melbourne date is `day`. A Melbourne day is
 * 23, 24 or 25 hours long and slots are every 2 hours in UTC, so the day's
 * slots are found by testing each slot around it, never by assuming 12.
 * (With a UTC+10/+11 zone the count is 12 on every day, DST days included;
 * the tests pin that.) Malformed or impossible dates (2026-02-31) give [].
 */
export function slotsForMelbourneDay(day: string): Date[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const [y, m, d] = day.split("-").map(Number);
  const slots: Date[] = [];
  // Melbourne is UTC+10/+11, so the day lies inside UTC [D-1 00:00, D+1 00:00).
  for (let h = -24; h < 24; h += SLOT_HOURS) {
    const slot = new Date(Date.UTC(y, m - 1, d, h));
    if (melbourneDay(slot) === day) slots.push(slot);
  }
  return slots;
}

/**
 * The days (input order) that are MISSED: any slot without a tick row whose
 * outcome is ok or partial. Failed, disabled and absent all count as missed.
 * Missed days are left out of the evaluation count, so the window extends.
 * A day with no slots (malformed string) is missed, so bad input never
 * counts as a clean day. slotAt must be the exact scheduled slot; a tick
 * stamped off the grid rescues nothing.
 */
export function missedDays(ticks: readonly Tick[], days: readonly string[]): string[] {
  const good = new Set(
    ticks
      .filter((t) => t.outcome === "ok" || t.outcome === "partial")
      .map((t) => t.slotAt.getTime()),
  );
  return days.filter((day) => {
    const slots = slotsForMelbourneDay(day);
    return slots.length === 0 || slots.some((s) => !good.has(s.getTime()));
  });
}

// ----------------------------------------------------------------------------
// Cohort and labels
// ----------------------------------------------------------------------------

/**
 * A candidate's cohort = the rubric version of its EARLIEST score row (ties:
 * lowest version). Derived and immutable: a later rescore under another
 * version adds a row but can never move the item (ENG-D9). null = no score
 * row yet. Rows with an unreadable createdAt or version are ignored.
 */
export function cohortOf(rows: readonly ScoreStamp[]): number | null {
  let best: ScoreStamp | null = null;
  for (const r of rows) {
    if (!Number.isFinite(r.createdAt.getTime()) || !Number.isFinite(r.rubricVersion)) continue;
    if (
      best === null ||
      r.createdAt.getTime() < best.createdAt.getTime() ||
      (r.createdAt.getTime() === best.createdAt.getTime() && r.rubricVersion < best.rubricVersion)
    ) {
      best = r;
    }
  }
  return best === null ? null : best.rubricVersion;
}

/**
 * Candidate id -> its current decision. Latest = highest sequence (the
 * database identity, not the array order or a timestamp), counted once. A
 * latest "clear" means unlabelled, so that candidate is absent from the map.
 */
export function currentDecisions(labels: readonly Label[]): Map<string, "keep" | "skip"> {
  const latest = new Map<string, Label>();
  for (const l of labels) {
    if (!Number.isFinite(l.sequence)) continue;
    const prev = latest.get(l.candidateId);
    if (!prev || l.sequence > prev.sequence) latest.set(l.candidateId, l);
  }
  const out = new Map<string, "keep" | "skip">();
  for (const [id, l] of latest) {
    if (l.decision === "keep" || l.decision === "skip") out.set(id, l.decision);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Gate
// ----------------------------------------------------------------------------

export interface GateInput {
  /** The cohort's candidates only, scored under the one explicit rubric version. */
  candidates: readonly Candidate[];
  cutoffs: Cutoffs;
  labels: readonly Label[];
  ticks: readonly Tick[];
  /** Melbourne days (YYYY-MM-DD) of the evaluation window so far. */
  days: readonly string[];
}

export interface GateCounts {
  eligibleCount: number;
  /** Eligible items with a current keep or skip: the gate population. */
  labelledEligible: number;
  kept: number;
  skipped: number;
  /** kept / labelledEligible, or null when nothing is labelled yet. */
  keepRate: number | null;
  /** Kept on an item that is NOT eligible (Jev missed a story Rob wants). Not in the rate. */
  keptNotEligible: number;
  validDays: number;
  missedDays: string[];
  criteria: { days: boolean; labelled: boolean; keepRate: boolean };
  /** The three measured criteria all hold. The gate is still not passed without the human check. */
  measuredCriteriaMet: boolean;
  /** See GATE_HUMAN_CHECK. Never computed. */
  needsHumanCheck: true;
}

/**
 * The gate numbers (CEO D11, ENG-D9 to D11). Population = eligible
 * candidates in the cohort with a current label. A relabel moves a count
 * between kept and skipped but never changes who is in the population. The
 * script enforces that an explicit rubric version was chosen; this function
 * counts whatever cohort it is handed.
 */
export function gateCounts(input: GateInput): GateCounts {
  const decisions = currentDecisions(input.labels);
  let eligibleCount = 0;
  let kept = 0;
  let skipped = 0;
  let keptNotEligible = 0;
  for (const c of input.candidates) {
    const decision = decisions.get(c.id);
    if (!isEligible(c, input.cutoffs)) {
      if (decision === "keep") keptNotEligible++;
      continue;
    }
    eligibleCount++;
    if (decision === "keep") kept++;
    else if (decision === "skip") skipped++;
  }

  const days = [...new Set(input.days)];
  const missed = missedDays(input.ticks, days);
  const labelledEligible = kept + skipped;
  const keepRate = labelledEligible === 0 ? null : kept / labelledEligible;
  const criteria = {
    days: days.length - missed.length >= GATE_MIN_DAYS,
    labelled: labelledEligible >= GATE_MIN_LABELLED,
    keepRate: keepRate !== null && keepRate >= GATE_MIN_KEEP_RATE,
  };

  return {
    eligibleCount,
    labelledEligible,
    kept,
    skipped,
    keepRate,
    keptNotEligible,
    validDays: days.length - missed.length,
    missedDays: missed,
    criteria,
    measuredCriteriaMet: criteria.days && criteria.labelled && criteria.keepRate,
    needsHumanCheck: true,
  };
}
