import type { LabelDecision, RadarProgress, RadarStatus } from "../../../lib/news-radar/radar-page-types";

// Every word the Radar page shows (plan DES-D8), in one place so a copy change is
// one deliberate edit and radar-copy.test.ts can assert it verbatim. Also the
// Melbourne time formatting, so "AEDT" and the clock agree everywhere.

const MELBOURNE = "Australia/Melbourne";
const UNDO_TITLE_MAX = 36;

function partsOf(d: Date, opts: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE, ...opts }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

/** "14:20" in Melbourne. */
export function formatClock(iso: string): string {
  const p = partsOf(new Date(iso), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.hour}:${p.minute}`;
}

/** "Mon 14:20": absolute, once per row (the relative time is a title attribute). */
export function formatRowTime(iso: string): string {
  const p = partsOf(new Date(iso), { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.weekday} ${p.hour}:${p.minute}`;
}

/** "Mon 26 Oct" for a Melbourne day YYYY-MM-DD. Noon UTC is the same date in Melbourne all year. */
export function formatDayHeader(day: string): string {
  const p = partsOf(new Date(`${day}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short" });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "AEDT" or "AEST", for the date given (defaults to now). */
export function tzAbbrev(at: Date = new Date()): string {
  return partsOf(at, { timeZoneName: "short" }).timeZoneName ?? "AEDT";
}

/** Cut a long title at a word boundary near UNDO_TITLE_MAX, then "...". */
export function truncateTitle(title: string): string {
  if (title.length <= UNDO_TITLE_MAX + 3) return title;
  const cut = title.slice(0, UNDO_TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > UNDO_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

const WORD: Record<LabelDecision, string> = { keep: "Kept", skip: "Skipped", clear: "Cleared" };

export const COPY = {
  hint: "Keep: I'd write about this. Skip: I wouldn't. Leave blank to decide later.",
  nothingYet: (next: string) => `Nothing to label yet. Next check ${next}.`,
  doneToday: (labelled: number, total: number, next: string) =>
    `Done for today. ${labelled} of ${total} labelled. Next check ${next}.`,
  emptyView: {
    shortlisted: "No shortlisted items in this cohort yet.",
    kept: "Nothing kept yet.",
    skipped: "Nothing skipped yet.",
    all: "No items yet.",
  },
  gateReady: (labelled: number, days: number) =>
    `Gate ready: ${labelled} labelled over ${days} days. Run the gate report.`,
  noKey: "Jev is not connected. Add the TypeSafe key in Integrations to start scoring.",
  openIntegrations: "Open Integrations",
  off: "Radar is off. Set the news_radar_enabled setting to start it.",
  loadError: "Couldn't load the radar.",
  retry: "Retry",
  notScored: "Not scored yet",
  labelInToLabel: "Label in To label",
  saveFailed: "Couldn't save. Retry",
  kept: "Kept",
  skipped: "Skipped",
  showScores: "Show scores",
  refresh: "Refresh",
  undo: (decision: LabelDecision, title: string) => `${WORD[decision]} '${truncateTitle(title)}'. Undo`,
  conflict: (now: "keep" | "skip" | null, mine: LabelDecision) =>
    `Changed in another tab. Now: ${now === "keep" ? "Kept" : now === "skip" ? "Skipped" : "Not labelled"}. Use mine (${mine === "keep" ? "Keep" : mine === "skip" ? "Skip" : "Clear"})`,
  newItems: (n: number) => `${n} new`,
  showMore: (n: number) => `Show ${n} more`,
  continued: "(continued)",
  toLabelCount: (n: number) => `${n} to label`,
} as const;

// What a failed tick means, in words Rob can act on. Anything unlisted points at
// the runbook rather than showing an error class.
const CAUSE: Record<string, string> = {
  JevAuthError: "Jev unavailable",
  JevKeyMissing: "Jev unavailable",
  JevRateLimitError: "Jev busy",
  JevOverloadedError: "Jev busy",
  JevShapeError: "Jev unavailable",
  FeedFetchError: "news feed unreachable",
  FeedParseError: "news feed unreadable",
  NoRubric: "no rubric set",
  RubricInvalid: "rubric invalid",
};

export interface StatusLines {
  today: string;
  cohort: string;
  health: string;
  tone: "ok" | "warn" | "bad" | "muted";
}

/** The two-level status area (DES-D5): progress first, a quiet health line second. */
export function statusLines(
  progress: RadarProgress,
  status: RadarStatus,
  cohortVersion: number | null,
  tz: string,
): StatusLines {
  const next = formatClock(status.nextCheckAt);
  const nextWithZone = `${next} ${tz}`;
  const today = `Today ${progress.todayLabelled} of ${progress.todayTotal} labelled`;
  const cohort =
    cohortVersion === null
      ? ""
      : progress.gateReady
        ? COPY.gateReady(progress.cohortLabelled, progress.validDays)
        : `Cohort v${cohortVersion}: ${progress.cohortLabelled} of ${progress.cohortTarget} labelled · day ${progress.validDays} of ${progress.targetDays}`;

  switch (status.state) {
    case "off":
      return { today, cohort, health: COPY.off, tone: "muted" };
    case "no-key":
      return { today, cohort, health: COPY.noKey, tone: "bad" };
    case "failing": {
      const at = status.failedSlotAt ? formatClock(status.failedSlotAt) : "latest";
      const cause = CAUSE[status.failureClass ?? ""] ?? "see the runbook";
      return { today, cohort, health: `Failing: the ${at} check failed (${cause}). Next check ${next}.`, tone: "bad" };
    }
    case "stale":
      return {
        today,
        cohort,
        health: status.lastCheckAt
          ? `Stale: no successful check since ${formatClock(status.lastCheckAt)} ${tz}. Next check ${next}.`
          : `Stale: no successful check yet. Next check ${nextWithZone}.`,
        tone: "warn",
      };
    default:
      return {
        today,
        cohort,
        health: `Healthy · updated ${status.lastCheckAt ? formatClock(status.lastCheckAt) : "just now"} · next check ${nextWithZone}`,
        tone: "ok",
      };
  }
}
