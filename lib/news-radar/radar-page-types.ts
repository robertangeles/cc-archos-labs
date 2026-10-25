// The shapes the Radar page, its two admin routes and the queries behind them
// agree on. Types and constants only, no imports from server code, so the client
// list component can import it. Design: plan DES-D3 to DES-D14 (outside the repo,
// ceo-plans/2026-10-25-blog-pipeline-rebuild-plan.md).

export const RADAR_VIEWS = ["to-label", "shortlisted", "kept", "skipped", "all"] as const;
export type RadarView = (typeof RADAR_VIEWS)[number];

/** What the page may send. `clear` un-labels an item (DES-D6). */
export type LabelDecision = "keep" | "skip" | "clear";

/** An item's CURRENT label. No label, or a latest `clear`, is `null`. */
export interface RadarLabel {
  id: string;
  decision: "keep" | "skip";
}

export type CandidateStatus = "new" | "scoring" | "scored" | "unscored" | "failed";

export interface RadarRow {
  id: string;
  title: string;
  summary: string;
  category: string | null;
  sourceUrl: string;
  /** Host of sourceUrl, shown as the row's source. */
  sourceHost: string;
  /** ISO instant. */
  publishedAt: string;
  /** Melbourne local date YYYY-MM-DD of publishedAt: the day panel it belongs to. */
  day: string;
  status: CandidateStatus;
  /** Rubric version of the item's earliest score row; null = not scored yet. */
  cohortVersion: number | null;
  /** Eligible under its cohort's cut-offs (decide.isEligible). Unscored = false. */
  eligible: boolean;
  /** Null until scored. */
  audienceFit: { score: number; confidence: number } | null;
  /** Cosine distance to the nearest published post; null = novelty unavailable. */
  noveltyDistance: number | null;
  /** Current label; null for no label or a latest `clear`. */
  label: RadarLabel | null;
  /**
   * Id of the NEWEST label row, including a `clear` row; null when the item was
   * never labelled. The page sends it back as `ifLatestLabelId`, so a client that
   * last saw a clear row is not falsely told it conflicts.
   */
  latestLabelId: string | null;
}

/**
 * One Melbourne day. `rows` are shown; `more` is only filled in the Shortlisted
 * view (the daily cap N, DES-D11) and is empty everywhere else.
 */
export interface RadarDay {
  day: string;
  rows: RadarRow[];
  more: RadarRow[];
  /** All view only: this page opens on a day the previous page ended on. */
  continued?: boolean;
}

export interface RadarCohort {
  version: number;
  /** ISO instant the cohort's first score row was written; null = nothing scored yet. */
  startedAt: string | null;
  isActive: boolean;
}

export interface RadarCounts {
  /** Eligible, in the cohort, with no current label. */
  toLabel: number;
  shortlisted: number;
  kept: number;
  skipped: number;
  /** Every item in the cohort, scored or not-yet-scored included for the active one. */
  all: number;
}

export interface RadarProgress {
  /** Eligible items published today (Melbourne) that carry a current label. */
  todayLabelled: number;
  /** Eligible items published today (Melbourne). */
  todayTotal: number;
  /** Labelled eligible items in the selected cohort (gate: at least 50). */
  cohortLabelled: number;
  cohortTarget: number;
  /** Melbourne days in the window with every slot run (gate: at least 7). */
  validDays: number;
  targetDays: number;
  /** All three measured gate criteria hold. */
  gateReady: boolean;
}

/**
 * off      the radar flag is off
 * no-key   no Jev key is stored (and the flag is on)
 * healthy  the last tick finished ok or partial less than 3 hours ago
 * stale    no successful tick for more than 3 hours
 * failing  the most recent tick failed
 */
export type RadarHealthState = "off" | "no-key" | "healthy" | "stale" | "failing";

export interface RadarStatus {
  state: RadarHealthState;
  /** ISO finish time of the last ok or partial tick; null = none yet. */
  lastCheckAt: string | null;
  /** Error class of the most recent failed tick (JevAuthError, FeedFetchError, ...). */
  failureClass: string | null;
  /** ISO slot of the most recent failed tick. */
  failedSlotAt: string | null;
  /** ISO instant of the next 2-hour UTC slot after now. */
  nextCheckAt: string;
}

export interface RadarPageData {
  view: RadarView;
  /** Null until the first rubric version exists. */
  cohort: RadarCohort | null;
  /** Newest first. */
  cohorts: RadarCohort[];
  counts: RadarCounts;
  /** Newest day first. */
  days: RadarDay[];
  /** Only the All view paginates (50 a page); null elsewhere. */
  page: { number: number; pages: number } | null;
  progress: RadarProgress;
  status: RadarStatus;
  /** ISO instant the data was read; the client passes it back as `since`. */
  generatedAt: string;
}

/** GET /api/admin/radar?summary=1&since=ISO: cheap poll behind "3 new . Refresh". */
export interface RadarSummary {
  /** Eligible items whose first score row is newer than `since`, in the active cohort. */
  newCount: number;
  status: RadarStatus;
  generatedAt: string;
}

export interface LabelRequest {
  decision: LabelDecision;
  /** Client-generated uuid; a repeated one returns the stored result. */
  requestId: string;
  /** `latestLabelId` the client last saw (null = it saw no label row). Omit to skip the check. */
  ifLatestLabelId?: string | null;
}

/** 200 body of PATCH /api/admin/radar/[id]. */
export interface LabelOk {
  ok: true;
  /** The item's current label after this call. */
  label: RadarLabel | null;
  /** The newest label row after this call (a `clear` row counts). */
  latestLabelId: string | null;
  /** False when nothing was written: same decision, or a replayed request id. */
  changed: boolean;
}

/** 409 body: someone else labelled first. The page offers "Use mine". */
export interface LabelConflict {
  ok: false;
  error: "conflict";
  current: RadarLabel | null;
  latestLabelId: string | null;
}

export const RADAR_PAGE_SIZE = 50;
/** Stale = no successful tick for more than this (DES-D8). */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
