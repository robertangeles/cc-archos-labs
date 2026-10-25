import { asc, desc, sql, type SQL } from "drizzle-orm";
import type { DB } from "../db";
import { newsRadarRubric, newsRadarTick } from "../db/schema";
import { getIntegrationConfig } from "../integration-config";
import {
  GATE_MIN_DAYS,
  GATE_MIN_LABELLED,
  currentDecisions,
  gateCounts,
  isEligible,
  melbourneDay,
  orderEligible,
  shortlistView,
  type Candidate,
  type Cutoffs,
  type Label,
  type Tick,
} from "./decide";
import {
  RADAR_PAGE_SIZE,
  STALE_AFTER_MS,
  type CandidateStatus,
  type RadarCohort,
  type RadarCounts,
  type RadarDay,
  type RadarHealthState,
  type RadarPageData,
  type RadarProgress,
  type RadarRow,
  type RadarStatus,
  type RadarSummary,
  type RadarView,
} from "./radar-page-types";
import { isNewsRadarEnabled } from "./radar";
import { parseRubricConfig } from "./rubric";

// Everything the Radar page and the gate report read. One query for the cohort's
// items (scores, current label), a few small ones for rubrics, ticks and the
// flag, then plain TypeScript over decide.ts: the page and the gate report share
// the SAME eligibility, ordering and gate counts (ENG-D9 to D11, DES-D3 to D14).

const SLOT_MS = 2 * 60 * 60 * 1000;

export interface RadarDeps {
  now?: () => Date;
  hasJevKey?: () => Promise<boolean>;
  isEnabled?: (db: DB) => Promise<boolean>;
}

export interface CohortSnapshot {
  version: number;
  startedAt: Date | null;
  cutoffs: Cutoffs;
  candidates: Candidate[];
  titles: Map<string, string>;
  /** Every label row of the cohort's candidates, history included. */
  labels: Label[];
  ticks: Tick[];
}

// postgres-js returns the rows as an array; pglite (tests) returns { rows }.
function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : (res as { rows: T[] }).rows;
}

// Raw sql comes back as strings from postgres-js (drizzle disables its date
// parsers) and as Dates from pglite.
const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const toNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// An item's cohort = the rubric version of its EARLIEST score row, ties to the lowest.
const FIRST_SCORE = sql`
  SELECT DISTINCT ON (candidate_id) candidate_id, rubric_version, created_at
    FROM news_candidate_score
   ORDER BY candidate_id, created_at, rubric_version`;

interface Rubric {
  version: number;
  config: unknown;
  /** Earliest first score row among the cohort's items. */
  startedAt: Date | null;
}

/** Every rubric version, newest (active) first. */
async function loadRubrics(db: DB): Promise<Rubric[]> {
  const [rubrics, starts] = await Promise.all([
    db
      .select({ version: newsRadarRubric.version, config: newsRadarRubric.config })
      .from(newsRadarRubric)
      .orderBy(desc(newsRadarRubric.version)),
    db.execute(sql`
      SELECT rubric_version AS version, min(created_at) AS started_at
        FROM (${FIRST_SCORE}) first_score
       GROUP BY rubric_version`),
  ]);
  const startedAt = new Map(
    rowsOf<{ version: unknown; started_at: unknown }>(starts).map((r) => [
      Number(r.version),
      toDate(r.started_at),
    ]),
  );
  return rubrics.map((r) => ({ ...r, startedAt: startedAt.get(r.version) ?? null }));
}

function cutoffsOf(config: unknown): Cutoffs | null {
  try {
    return parseRubricConfig(config).cutoffs;
  } catch {
    return null;
  }
}

interface ItemRecord {
  id: string;
  title: string;
  summary: string;
  category: string | null;
  source_url: string;
  published_at: unknown;
  status: string;
  cohort_version: unknown;
  fit_score: unknown;
  fit_confidence: unknown;
  novelty_distance: unknown;
  label_id: string | null;
  label_sequence: unknown;
  label_decision: string | null;
}

interface Item {
  record: ItemRecord;
  candidate: Candidate;
  label: Label | null;
  labelId: string | null;
}

/**
 * The items of one cohort with the scores read under THAT version only and the
 * newest label row. `includeUnscored` adds the items with no score row at all
 * (only the active cohort shows them); `scoredAfter` keeps items whose first
 * score row is newer.
 */
async function loadItems(
  db: DB,
  version: number,
  opts: { includeUnscored?: boolean; scoredAfter?: Date } = {},
): Promise<Item[]> {
  const scoredAfter: SQL = opts.scoredAfter
    ? sql`AND f.created_at > ${opts.scoredAfter.toISOString()}::timestamptz`
    : sql``;
  const res = await db.execute(sql`
    SELECT c.id, c.title, c.summary, c.category, c.source_url, c.published_at, c.status,
           f.rubric_version AS cohort_version,
           fit.score AS fit_score, fit.confidence AS fit_confidence,
           nov.score AS novelty_distance,
           lab.id AS label_id, lab.sequence AS label_sequence, lab.decision AS label_decision
      FROM news_candidate c
      LEFT JOIN (${FIRST_SCORE}) f ON f.candidate_id = c.id
      LEFT JOIN news_candidate_score fit
             ON fit.candidate_id = c.id AND fit.rubric_version = f.rubric_version
            AND fit.question_key = 'audience_fit'
      LEFT JOIN news_candidate_score nov
             ON nov.candidate_id = c.id AND nov.rubric_version = f.rubric_version
            AND nov.question_key = 'novelty'
      LEFT JOIN LATERAL (
        SELECT id, sequence, decision FROM news_candidate_label
         WHERE candidate_id = c.id ORDER BY sequence DESC LIMIT 1
      ) lab ON true
     WHERE (f.rubric_version = ${version}::integer
            OR (${opts.includeUnscored ?? false}::boolean AND f.rubric_version IS NULL))
       ${scoredAfter}`);

  return rowsOf<ItemRecord>(res).map((r) => {
    const fitScore = toNum(r.fit_score);
    const fitConfidence = toNum(r.fit_confidence);
    return {
      record: r,
      candidate: {
        id: r.id,
        publishedAt: toDate(r.published_at),
        // A score without a confidence is unusable: not eligible, never a 0 that passes C = 0.
        audienceFit:
          fitScore === null || fitConfidence === null
            ? null
            : { score: fitScore, confidence: fitConfidence },
        noveltyDistance: toNum(r.novelty_distance),
      },
      label:
        r.label_id === null
          ? null
          : {
              candidateId: r.id,
              sequence: Number(r.label_sequence),
              decision: r.label_decision as Label["decision"],
            },
      labelId: r.label_id,
    };
  });
}

async function loadTicks(db: DB) {
  const rows = await db
    .select({
      slotAt: newsRadarTick.slotAt,
      finishedAt: newsRadarTick.finishedAt,
      outcome: newsRadarTick.outcome,
      errorClass: newsRadarTick.errorClass,
    })
    .from(newsRadarTick)
    .orderBy(asc(newsRadarTick.slotAt));
  return rows.map((r) => ({ ...r, outcome: r.outcome as Tick["outcome"] }));
}
type TickRow = Awaited<ReturnType<typeof loadTicks>>[number];

async function defaultHasJevKey(): Promise<boolean> {
  return Boolean((await getIntegrationConfig()).typesafeApiKey);
}

async function buildStatus(
  db: DB,
  now: Date,
  ticks: TickRow[],
  deps: RadarDeps,
): Promise<RadarStatus> {
  let latest: TickRow | null = null; // highest slot
  let lastOk: Date | null = null; // latest finish of an ok or partial tick
  for (const t of ticks) {
    if (!latest || t.slotAt > latest.slotAt) latest = t;
    if ((t.outcome === "ok" || t.outcome === "partial") && (!lastOk || t.finishedAt > lastOk)) {
      lastOk = t.finishedAt;
    }
  }

  let state: RadarHealthState;
  if (!(await (deps.isEnabled ?? isNewsRadarEnabled)(db))) state = "off";
  else if (!(await (deps.hasJevKey ?? defaultHasJevKey)())) state = "no-key";
  else if (latest?.outcome === "failed") state = "failing";
  else if (!lastOk || now.getTime() - lastOk.getTime() > STALE_AFTER_MS) state = "stale";
  else state = "healthy";

  return {
    state,
    lastCheckAt: lastOk?.toISOString() ?? null,
    failureClass: state === "failing" ? (latest?.errorClass ?? null) : null,
    failedSlotAt: state === "failing" ? (latest?.slotAt.toISOString() ?? null) : null,
    nextCheckAt: new Date((Math.floor(now.getTime() / SLOT_MS) + 1) * SLOT_MS).toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Rows, days, pages
// ----------------------------------------------------------------------------

const byNewest = (a: Candidate, b: Candidate) =>
  b.publishedAt.getTime() - a.publishedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function toRow(item: Item, cutoffs: Cutoffs | null, decision: "keep" | "skip" | undefined): RadarRow {
  const { record: r, candidate } = item;
  let sourceHost = "";
  try {
    sourceHost = new URL(r.source_url).host;
  } catch {
    // keep "": the row just shows no source
  }
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    category: r.category,
    sourceUrl: r.source_url,
    sourceHost,
    publishedAt: candidate.publishedAt.toISOString(),
    day: melbourneDay(candidate.publishedAt),
    status: r.status as CandidateStatus,
    cohortVersion: toNum(r.cohort_version),
    eligible: cutoffs !== null && isEligible(candidate, cutoffs),
    audienceFit: candidate.audienceFit,
    noveltyDistance: candidate.noveltyDistance,
    label: decision && item.labelId ? { id: item.labelId, decision } : null,
    latestLabelId: item.labelId,
  };
}

/** Groups rows into Melbourne days, newest day first; row order inside a day is kept. */
function groupByDay(rows: RadarRow[]): RadarDay[] {
  const days = new Map<string, RadarRow[]>();
  for (const r of rows) days.set(r.day, [...(days.get(r.day) ?? []), r]);
  return [...days.keys()]
    .sort()
    .reverse()
    .map((day) => ({ day, rows: days.get(day) ?? [], more: [] }));
}

/** YYYY-MM-DD from `startDay` to `endDay` inclusive. Calendar arithmetic only, no time zone. */
function daysThrough(startDay: string, endDay: string): string[] {
  const [y, m, d] = startDay.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    if (day > endDay) return out;
    out.push(day);
  }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export async function loadRadarPage(
  db: DB,
  params: { view: RadarView; cohort?: number; page?: number },
  deps: RadarDeps = {},
): Promise<RadarPageData> {
  const now = (deps.now ?? (() => new Date()))();
  const [rubrics, ticks] = await Promise.all([loadRubrics(db), loadTicks(db)]);
  const active = rubrics[0];
  const selected = rubrics.find((r) => r.version === params.cohort) ?? active;
  const status = await buildStatus(db, now, ticks, deps);
  const toCohort = (r: Rubric): RadarCohort => ({
    version: r.version,
    startedAt: r.startedAt?.toISOString() ?? null,
    isActive: r.version === active.version,
  });

  const today = melbourneDay(now);
  const base = {
    view: params.view,
    cohort: null as RadarCohort | null,
    cohorts: rubrics.map(toCohort),
    counts: { toLabel: 0, shortlisted: 0, kept: 0, skipped: 0, all: 0 } satisfies RadarCounts,
    days: [] as RadarDay[],
    page: params.view === "all" ? { number: 1, pages: 1 } : null,
    progress: {
      todayLabelled: 0,
      todayTotal: 0,
      cohortLabelled: 0,
      cohortTarget: GATE_MIN_LABELLED,
      validDays: 0,
      targetDays: GATE_MIN_DAYS,
      gateReady: false,
    } satisfies RadarProgress,
    status,
    generatedAt: now.toISOString(),
  };
  if (!selected) return base;

  const isActive = selected.version === active.version;
  const cutoffs = cutoffsOf(selected.config);
  const items = await loadItems(db, selected.version, { includeUnscored: isActive });
  const decisions = currentDecisions(items.flatMap((i) => (i.label ? [i.label] : [])));
  const rows = new Map(items.map((i) => [i.candidate.id, toRow(i, cutoffs, decisions.get(i.candidate.id))]));
  const rowOf = (c: Candidate) => rows.get(c.id) as RadarRow;
  const eligible = items.filter((i) => rows.get(i.candidate.id)?.eligible);
  const withDecision = (d: "keep" | "skip" | null) =>
    eligible.filter((i) => (decisions.get(i.candidate.id) ?? null) === d);

  const counts: RadarCounts = {
    toLabel: withDecision(null).length,
    shortlisted: eligible.length,
    kept: withDecision("keep").length,
    skipped: withDecision("skip").length,
    all: items.length,
  };

  let days: RadarDay[] = [];
  let pageInfo: RadarPageData["page"] = null;
  if (params.view === "to-label") {
    days = groupByDay(
      withDecision(null)
        .map((i) => i.candidate)
        .sort(byNewest)
        .map(rowOf),
    );
  } else if (params.view === "shortlisted") {
    days = cutoffs
      ? shortlistView(eligible.map((i) => i.candidate), cutoffs).map((d) => ({
          day: d.day,
          rows: d.shown.map(rowOf),
          more: d.more.map(rowOf),
        }))
      : [];
  } else if (params.view === "kept" || params.view === "skipped") {
    const wanted = withDecision(params.view === "kept" ? "keep" : "skip");
    days = cutoffs
      ? groupByDay(orderEligible(wanted.map((i) => i.candidate), cutoffs).map(rowOf))
      : [];
  } else {
    const ordered = items.map((i) => i.candidate).sort(byNewest);
    const pages = Math.max(1, Math.ceil(ordered.length / RADAR_PAGE_SIZE));
    const number = Math.min(Math.max(params.page ?? 1, 1), pages);
    const start = (number - 1) * RADAR_PAGE_SIZE;
    const slice = ordered.slice(start, start + RADAR_PAGE_SIZE).map(rowOf);
    days = groupByDay(slice);
    // The page opens on the day the previous one ended on: the client prints "(continued)".
    if (number > 1 && days.length > 0 && rowOf(ordered[start - 1]).day === days[0].day) {
      days[0].continued = true;
    }
    pageInfo = { number, pages };
  }

  // Gate progress over the cohort's own items. The window runs from the cohort's
  // start day to today; today and a partial first day count as missed (decide).
  const scored = items.filter((i) => rows.get(i.candidate.id)?.cohortVersion !== null);
  const gate = cutoffs
    ? gateCounts({
        candidates: scored.map((i) => i.candidate),
        cutoffs,
        labels: items.flatMap((i) => (i.label ? [i.label] : [])),
        ticks: ticks.map((t) => ({ slotAt: t.slotAt, outcome: t.outcome })),
        days: selected.startedAt ? daysThrough(melbourneDay(selected.startedAt), today) : [],
      })
    : null;
  const todays = eligible.filter((i) => rows.get(i.candidate.id)?.day === today);

  return {
    ...base,
    cohort: toCohort(selected),
    counts,
    days,
    page: pageInfo,
    progress: {
      ...base.progress,
      todayLabelled: todays.filter((i) => decisions.has(i.candidate.id)).length,
      todayTotal: todays.length,
      cohortLabelled: gate?.labelledEligible ?? 0,
      validDays: gate?.validDays ?? 0,
      gateReady: gate?.measuredCriteriaMet ?? false,
    },
  };
}

/** Cheap poll behind "3 new . Refresh": eligible items first scored after `since`, plus status. */
export async function loadRadarSummary(
  db: DB,
  since: Date,
  deps: RadarDeps = {},
): Promise<RadarSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const [rubrics, ticks] = await Promise.all([loadRubrics(db), loadTicks(db)]);
  const cutoffs = rubrics[0] ? cutoffsOf(rubrics[0].config) : null;
  const fresh =
    rubrics[0] && cutoffs
      ? await loadItems(db, rubrics[0].version, { scoredAfter: since })
      : [];
  return {
    newCount: fresh.filter((i) => cutoffs && isEligible(i.candidate, cutoffs)).length,
    status: await buildStatus(db, now, ticks, deps),
    generatedAt: now.toISOString(),
  };
}

/**
 * One cohort's candidates, every label row and all ticks, in decide.ts shapes,
 * for the gate report. Throws when the version does not exist or its stored
 * config is invalid: a report must never run on a rubric it cannot read.
 */
export async function loadCohortSnapshot(db: DB, version: number): Promise<CohortSnapshot> {
  const rubrics = await loadRubrics(db);
  const rubric = rubrics.find((r) => r.version === version);
  if (!rubric) throw new Error(`No rubric version ${version}`);
  const cutoffs = parseRubricConfig(rubric.config).cutoffs;

  const [items, labelRes, ticks] = await Promise.all([
    loadItems(db, version),
    db.execute(sql`
      SELECT l.candidate_id, l.sequence, l.decision
        FROM news_candidate_label l
        JOIN (${FIRST_SCORE}) f ON f.candidate_id = l.candidate_id
       WHERE f.rubric_version = ${version}::integer
       ORDER BY l.sequence`),
    loadTicks(db),
  ]);

  return {
    version,
    startedAt: rubric.startedAt,
    cutoffs,
    candidates: items.map((i) => i.candidate),
    titles: new Map(items.map((i) => [i.record.id, i.record.title])),
    labels: rowsOf<{ candidate_id: string; sequence: unknown; decision: string }>(labelRes).map(
      (l) => ({
        candidateId: l.candidate_id,
        sequence: Number(l.sequence),
        decision: l.decision as Label["decision"],
      }),
    ),
    ticks: ticks.map((t) => ({ slotAt: t.slotAt, outcome: t.outcome })),
  };
}
