"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { melbourneDay } from "../../../lib/news-radar/decide";
import {
  RADAR_VIEWS,
  type LabelConflict,
  type LabelDecision,
  type LabelOk,
  type RadarCohort,
  type RadarDay,
  type RadarPageData,
  type RadarRow,
  type RadarSummary,
  type RadarView,
} from "../../../lib/news-radar/radar-page-types";
import { COPY, formatClock, formatDayHeader, formatRowTime, statusLines, tzAbbrev } from "./radar-copy";
import { applyLabelLocally, findRow, nextDecision, pendingLabel } from "./radar-state";

// The Radar page's one client module (plan ENG-D2, DES-D3 to DES-D14). The server
// page hands over the first load; filter changes, labelling and the "new items"
// poll go through /api/admin/radar. Labelling is blind (scores are hidden until
// "Show scores" is on), instant (the row updates before the save returns, with a
// visible revert on failure), and correctable (switch, clear, a 6 second Undo,
// and "Use mine" after a conflict). The list never reorders on its own.

const VIEW_LABEL: Record<RadarView, string> = {
  "to-label": "To label",
  shortlisted: "Shortlisted",
  kept: "Kept",
  skipped: "Skipped",
  all: "All",
};
const POLL_MS = 60_000;
const UNDO_MS = 6_000;

interface PendingSave {
  rowId: string;
  decision: LabelDecision;
  requestId: string;
  ifLatestLabelId: string | null;
}

interface RowUi {
  saving?: boolean;
  failed?: PendingSave;
  conflict?: { currentDecision: "keep" | "skip" | null; latestLabelId: string | null; mine: LabelDecision };
}

interface Toast {
  key: number;
  text: string;
  undo: () => void;
}

function cohortLabel(c: RadarCohort, newer: RadarCohort | undefined): string {
  if (!c.startedAt) return `Cohort v${c.version}`;
  const dayOf = (iso: string) => melbourneDay(new Date(iso));
  const parts = (day: string) => {
    const [, d, mon] = formatDayHeader(day).split(" ");
    return { d, mon };
  };
  const from = parts(dayOf(c.startedAt));
  if (!newer?.startedAt) return `Cohort v${c.version} · ${from.d} ${from.mon}`;
  // The cohort ran until the day before the next one started.
  const to = parts(dayOf(new Date(new Date(newer.startedAt).getTime() - 86_400_000).toISOString()));
  if (to.d === from.d && to.mon === from.mon) return `Cohort v${c.version} · ${from.d} ${from.mon}`;
  return from.mon === to.mon
    ? `Cohort v${c.version} · ${from.d}-${to.d} ${from.mon}`
    : `Cohort v${c.version} · ${from.d} ${from.mon}-${to.d} ${to.mon}`;
}

const sourceCategory = (c: string | null) => (c ? (c.length <= 3 ? c.toUpperCase() : c[0].toUpperCase() + c.slice(1)) : null);

function relative(iso: string, nowIso: string): string {
  const mins = Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
}

// "Show scores" lives in localStorage so it survives a reload. useSyncExternalStore
// keeps the server render (off) and the first client render identical.
const SCORES_EVENT = "radar-scores-change";
function subscribeScores(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SCORES_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SCORES_EVENT, onChange);
  };
}
function readScores(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeScores(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Private mode: the switch simply does not persist.
  }
  window.dispatchEvent(new Event(SCORES_EVENT));
}

// ---------------------------------------------------------------------------

export function RadarList({ initial }: { initial: RadarPageData | null }) {
  const [data, setData] = useState<RadarPageData | null>(initial);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(initial === null);
  const [rowUi, setRowUi] = useState<Record<string, RowUi>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [live, setLive] = useState("");
  const [newCount, setNewCount] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });
  const sendRef = useRef<(save: PendingSave, opts?: { undoTo?: LabelDecision; announce?: string }) => Promise<void>>(null);
  const toastKey = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const view: RadarView = data?.view ?? "to-label";
  const cohortVersion = data?.cohort?.version ?? null;
  const today = data ? melbourneDay(new Date(data.generatedAt)) : "";

  // "Show scores" is page-wide, per browser, and starts off again for each new cohort.
  const scoresKey = `radar.showScores.v${cohortVersion}`;
  const showScores = useSyncExternalStore(
    subscribeScores,
    () => readScores(scoresKey),
    () => false,
  );
  const toggleScores = () => writeScores(scoresKey, !showScores);

  // --- loading a view -----------------------------------------------------

  const load = useCallback(async (params: { view: RadarView; cohort?: number; page?: number }) => {
    setLoading(true);
    setLoadError(false);
    const qs = new URLSearchParams({ view: params.view });
    if (params.cohort) qs.set("cohort", String(params.cohort));
    if (params.page && params.page > 1) qs.set("page", String(params.page));
    try {
      const res = await fetch(`/api/admin/radar?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const next = (await res.json()) as RadarPageData;
      setData(next);
      setNewCount(0);
      setExpanded({});
      window.history.replaceState(null, "", `?${qs}`);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const current = () => ({ view, cohort: data?.cohort?.version, page: data?.page?.number });

  // --- "N new" poll: never inserts rows, only offers a refresh ---------------

  useEffect(() => {
    if (!data) return;
    const since = data.generatedAt;
    const id = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/admin/radar?summary=1&since=${encodeURIComponent(since)}`, { cache: "no-store" });
        if (!res.ok) return;
        const s = (await res.json()) as RadarSummary;
        setNewCount(s.newCount);
        setData((d) => (d ? { ...d, status: s.status } : d));
      } catch {
        // A missed poll is silent; the next one retries.
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [data?.generatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- labelling -----------------------------------------------------------

  const showToast = useCallback((text: string, undo: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastKey.current += 1;
    setToast({ key: toastKey.current, text, undo });
    toastTimer.current = setTimeout(() => setToast(null), UNDO_MS);
  }, []);

  const send = useCallback(
    async (save: PendingSave, opts: { undoTo?: LabelDecision; announce?: string } = {}) => {
      const before = dataRef.current && findRow(dataRef.current, save.rowId);
      if (!before) return;
      const prior = { label: before.label, latestLabelId: before.latestLabelId };
      setRowUi((u) => ({ ...u, [save.rowId]: { saving: true } }));
      setData((d) => d && applyLabelLocally(d, save.rowId, pendingLabel(save.decision), before.latestLabelId, today));

      const revert = () =>
        setData((d) => d && applyLabelLocally(d, save.rowId, prior.label, prior.latestLabelId, today));

      try {
        const res = await fetch(`/api/admin/radar/${save.rowId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: save.decision,
            requestId: save.requestId,
            ifLatestLabelId: save.ifLatestLabelId,
          }),
        });
        if (res.status === 409) {
          const body = (await res.json()) as LabelConflict;
          setData((d) => d && applyLabelLocally(d, save.rowId, body.current, body.latestLabelId, today));
          // Someone else already made the change I asked for: nothing to resolve.
          if ((body.current?.decision ?? null) === (save.decision === "clear" ? null : save.decision)) {
            setRowUi((u) => ({ ...u, [save.rowId]: {} }));
            return;
          }
          setRowUi((u) => ({
            ...u,
            [save.rowId]: { conflict: { currentDecision: body.current?.decision ?? null, latestLabelId: body.latestLabelId, mine: save.decision } },
          }));
          setLive(COPY.conflict(body.current?.decision ?? null, save.decision));
          return;
        }
        if (!res.ok) throw new Error("save");
        const body = (await res.json()) as LabelOk;
        setData((d) => d && applyLabelLocally(d, save.rowId, body.label, body.latestLabelId, today));
        setRowUi((u) => ({ ...u, [save.rowId]: {} }));
        if (body.changed) {
          setLive(`${opts.announce ?? COPY.undo(save.decision, before.title).replace(/\. Undo$/, "")}`);
          if (!opts.undoTo) {
            const undoTo: LabelDecision = prior.label?.decision ?? "clear";
            showToast(COPY.undo(save.decision, before.title), () =>
              void sendRef.current?.(
                { rowId: save.rowId, decision: undoTo, requestId: crypto.randomUUID(), ifLatestLabelId: body.latestLabelId },
                { undoTo, announce: "Undone" },
              ),
            );
          } else {
            setToast(null);
          }
        }
      } catch {
        revert();
        setRowUi((u) => ({ ...u, [save.rowId]: { failed: save } }));
        setLive(COPY.saveFailed);
      }
    },
    [showToast, today],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const press = (row: RadarRow, pressed: "keep" | "skip") =>
    void send({
      rowId: row.id,
      decision: nextDecision(row.label, pressed),
      requestId: crypto.randomUUID(),
      ifLatestLabelId: row.latestLabelId,
    });

  // --- render --------------------------------------------------------------

  if (!data) {
    return (
      <div>
        <LoadError onRetry={() => void load({ view: "to-label" })} loading={loading} />
      </div>
    );
  }

  const tz = tzAbbrev(new Date(data.generatedAt));
  const lines = statusLines(data.progress, data.status, cohortVersion, tz);
  const labelsExist = data.counts.kept + data.counts.skipped > 0;
  const interactive = view === "to-label";
  const next = `${formatClock(data.status.nextCheckAt)} ${tz}`;

  return (
    <div id="radar">
      <div role="status" aria-live="polite" className="sr-only">
        {live}
      </div>

      {/* Status area: progress first, a quiet health line second (DES-D5). */}
      <div className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="text-[14px] leading-5 text-ink">{lines.today}</p>
          {lines.cohort && <p className="text-[14px] leading-5 text-ink-subtle">{lines.cohort}</p>}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
          <p className="flex items-center gap-2 text-[12px] leading-4 text-ink-subtle">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 rounded-full ${
                lines.tone === "ok" ? "bg-semantic-success" : lines.tone === "warn" ? "bg-semantic-warning" : lines.tone === "bad" ? "bg-semantic-error" : "bg-ink-tertiary"
              }`}
            />
            <span>{lines.health}</span>
            {data.status.state === "no-key" && (
              <Link href="/admin/integrations/typesafe" className="text-primary-hover underline">
                {COPY.openIntegrations}
              </Link>
            )}
          </p>
          {newCount > 0 && (
            <p className="text-[12px] leading-4 text-ink-subtle">
              {COPY.newItems(newCount)} ·{" "}
              <button
                type="button"
                onClick={() => void load(current())}
                className="text-primary-hover underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {COPY.refresh}
              </button>
            </p>
          )}
        </div>
      </div>

      {/* Pills and the cohort select (DES-D11). */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <nav aria-label="Radar views" className="-mx-1 flex min-w-0 flex-nowrap gap-1 overflow-x-auto px-1 max-sm:w-full">
          {RADAR_VIEWS.map((v) => {
            const count = v === "to-label" ? data.counts.toLabel : v === "shortlisted" ? data.counts.shortlisted : v === "kept" ? data.counts.kept : v === "skipped" ? data.counts.skipped : null;
            const active = v === view;
            return (
              <button
                key={v}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => void load({ view: v, cohort: data.cohort?.version })}
                className={`shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  active ? "border-ink text-ink" : "border-transparent text-ink-subtle hover:text-ink"
                }`}
              >
                {VIEW_LABEL[v]}
                {count !== null && <span className="ml-1.5 font-mono text-[12px] tabular-nums">{count}</span>}
              </button>
            );
          })}
        </nav>
        {data.cohorts.length > 0 && (
          <label className="max-sm:w-full">
            <span className="sr-only">Cohort</span>
            <select
              value={data.cohort?.version ?? ""}
              onChange={(e) => void load({ view, cohort: Number(e.target.value) })}
              className="rounded-md border border-ink-subtle bg-surface-1 px-2 py-1.5 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-sm:w-full"
            >
              {data.cohorts.map((c, i) => (
                <option key={c.version} value={c.version}>
                  {cohortLabel(c, data.cohorts[i - 1])}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* First-use hint and the Show scores switch (DES-D9). */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="text-[12px] leading-4 text-ink-subtle">{labelsExist ? "" : COPY.hint}</p>
        <button
          type="button"
          role="switch"
          aria-checked={showScores}
          onClick={toggleScores}
          className="flex items-center gap-2 text-[12px] leading-4 text-ink-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span>{COPY.showScores}</span>
          <span
            aria-hidden="true"
            className={`inline-flex h-4 w-7 items-center rounded-full border border-ink-subtle p-0.5 ${showScores ? "bg-primary" : "bg-transparent"}`}
          >
            <span className={`h-2.5 w-2.5 rounded-full bg-ink motion-safe:transition-transform motion-safe:duration-[120ms] ${showScores ? "translate-x-3" : ""}`} />
          </span>
        </button>
      </div>

      {loadError ? (
        <LoadError onRetry={() => void load(current())} loading={loading} />
      ) : (
        <div aria-busy={loading} className={loading ? "opacity-60" : ""}>
          {data.days.length === 0 ? (
            <EmptyState data={data} view={view} next={next} />
          ) : (
            data.days.map((day) => (
              <DayPanel
                key={day.day}
                day={day}
                view={view}
                generatedAt={data.generatedAt}
                interactive={interactive}
                showScores={showScores}
                rowUi={rowUi}
                expanded={!!expanded[day.day]}
                onExpand={() => setExpanded((e) => ({ ...e, [day.day]: true }))}
                onPress={press}
                onRetry={(save) => void send(save)}
                onUseMine={(row, conflict) =>
                  void send({
                    rowId: row.id,
                    decision: conflict.mine,
                    requestId: crypto.randomUUID(),
                    ifLatestLabelId: conflict.latestLabelId,
                  })
                }
              />
            ))
          )}
          {data.page && data.page.pages > 1 && (
            <Pager
              page={data.page.number}
              pages={data.page.pages}
              onGo={(p) => void load({ view, cohort: data.cohort?.version, page: p })}
            />
          )}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-4 z-20 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-md border border-ink-subtle bg-surface-1 px-4 py-2.5 text-[13px] text-ink shadow-none">
          <span className="min-w-0 truncate">{toast.text.replace(/\. Undo$/, ".")}</span>
          <button
            type="button"
            onClick={() => {
              if (toastTimer.current) clearTimeout(toastTimer.current);
              toast.undo();
            }}
            className="shrink-0 text-primary-hover underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LoadError({ onRetry, loading }: { onRetry: () => void; loading: boolean }) {
  return (
    <div role="alert" className="rounded-lg border border-hairline bg-surface-1 px-4 py-6 text-center">
      <p className="text-[14px] text-ink">{COPY.loadError}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={loading}
        className="mt-3 rounded-md border border-ink-subtle px-3 py-1.5 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
      >
        {COPY.retry}
      </button>
    </div>
  );
}

function EmptyState({ data, view, next }: { data: RadarPageData; view: RadarView; next: string }) {
  let text: string;
  if (view === "to-label") {
    const done = data.progress.todayTotal > 0 && data.progress.todayLabelled >= data.progress.todayTotal;
    text = done ? COPY.doneToday(data.progress.todayLabelled, data.progress.todayTotal, next) : COPY.nothingYet(next);
  } else {
    text = COPY.emptyView[view];
  }
  return (
    <div className="rounded-lg border border-hairline bg-surface-1 px-4 py-8 text-center text-[14px] text-ink-subtle">
      {text}
    </div>
  );
}

function Pager({ page, pages, onGo }: { page: number; pages: number; onGo: (p: number) => void }) {
  const btn =
    "rounded-md border border-ink-subtle px-3 py-1.5 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-disabled:opacity-50";
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
      <button type="button" className={btn} aria-disabled={page <= 1} onClick={() => page > 1 && onGo(page - 1)}>
        Previous
      </button>
      <span className="font-mono text-[12px] tabular-nums text-ink-subtle">
        {page} / {pages}
      </span>
      <button type="button" className={btn} aria-disabled={page >= pages} onClick={() => page < pages && onGo(page + 1)}>
        Next
      </button>
    </nav>
  );
}

interface DayPanelProps {
  day: RadarDay;
  view: RadarView;
  generatedAt: string;
  interactive: boolean;
  showScores: boolean;
  rowUi: Record<string, RowUi>;
  expanded: boolean;
  onExpand: () => void;
  onPress: (row: RadarRow, pressed: "keep" | "skip") => void;
  onRetry: (save: PendingSave) => void;
  onUseMine: (row: RadarRow, conflict: NonNullable<RowUi["conflict"]>) => void;
}

function DayPanel(p: DayPanelProps) {
  const rows = p.expanded ? [...p.day.rows, ...p.day.more] : p.day.rows;
  const hidden = p.expanded ? 0 : p.day.more.length;
  const toLabel = p.day.rows.concat(p.day.more).filter((r) => r.eligible && r.label === null).length;
  const headingId = `day-${p.day.day}`;
  return (
    <section aria-labelledby={headingId} className="mb-6 rounded-lg border border-hairline bg-surface-1">
      <div className="sticky top-0 z-10 flex items-baseline justify-between gap-4 rounded-t-lg border-b border-hairline bg-surface-1 px-4 py-2.5">
        <h2 id={headingId} className="text-[13px] font-medium text-ink">
          {formatDayHeader(p.day.day)}
          {p.day.continued && <span className="ml-2 font-normal text-ink-subtle">{COPY.continued}</span>}
        </h2>
        {p.view === "to-label" && <span className="text-[12px] text-ink-subtle">{COPY.toLabelCount(toLabel)}</span>}
      </div>
      <ul>
        {rows.map((row) => (
          <RowItem key={row.id} row={row} {...p} ui={p.rowUi[row.id]} />
        ))}
      </ul>
      {hidden > 0 && (
        <div className="border-t border-hairline px-4 py-2.5">
          <button
            type="button"
            onClick={p.onExpand}
            className="text-[13px] text-primary-hover underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {COPY.showMore(hidden)}
          </button>
        </div>
      )}
    </section>
  );
}

function RowItem({
  row,
  ui,
  view,
  generatedAt,
  interactive,
  showScores,
  onPress,
  onRetry,
  onUseMine,
}: DayPanelProps & { row: RadarRow; ui: RowUi | undefined }) {
  const titleId = `row-${row.id}`;
  const scored = row.status === "scored";
  const labelled = row.label !== null;
  const saving = !!ui?.saving;
  const category = sourceCategory(row.category);

  return (
    <li className="border-b border-hairline last:border-b-0">
      <div role="group" aria-labelledby={titleId} className="px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 lg:flex-1">
            <a
              id={titleId}
              href={row.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-[15px] font-medium leading-[22px] visited:text-ink-subtle hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                labelled ? "text-ink-subtle" : "text-ink"
              }`}
            >
              {row.title}
              <span className="sr-only"> (opens in new tab)</span>
            </a>
            <p className="mt-0.5 text-[12px] leading-4 text-ink-subtle">
              {row.sourceHost}
              {category && ` · ${category}`}
              {" · "}
              <time dateTime={row.publishedAt} title={relative(row.publishedAt, generatedAt)}>
                {formatRowTime(row.publishedAt)}
              </time>
            </p>
            {row.summary && <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-ink-subtle">{row.summary}</p>}
            {showScores && <Scores row={row} showUnavailable={view === "all"} />}
          </div>

          <div className="max-lg:self-end max-sm:w-full">
            {!scored ? (
              <p className="text-[12px] text-ink-subtle">{COPY.notScored}</p>
            ) : interactive ? (
              <div className="flex gap-2 max-sm:w-full" role="presentation">
                <LabelButton row={row} which="keep" saving={saving} onPress={onPress} />
                <LabelButton row={row} which="skip" saving={saving} onPress={onPress} />
              </div>
            ) : labelled ? (
              <p className="flex items-center gap-1.5 text-[13px] text-ink">
                <Check />
                {row.label?.decision === "keep" ? COPY.kept : COPY.skipped}
              </p>
            ) : (
              <p className="text-[12px] text-ink-subtle">{COPY.labelInToLabel}</p>
            )}
          </div>
        </div>

        {ui?.failed && (
          <p className="mt-2 text-right text-[12px] text-semantic-error max-sm:text-left">
            {COPY.saveFailed.replace(" Retry", "")}{" "}
            <button
              type="button"
              onClick={() => onRetry(ui.failed!)}
              className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Retry
            </button>
          </p>
        )}
        {ui?.conflict && (
          <p className="mt-2 text-right text-[12px] text-ink max-sm:text-left">
            {COPY.conflict(ui.conflict.currentDecision, ui.conflict.mine).replace(/ Use mine \(.*\)$/, "")}{" "}
            <button
              type="button"
              onClick={() => onUseMine(row, ui.conflict!)}
              className="text-primary-hover underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Use mine ({ui.conflict.mine === "keep" ? "Keep" : ui.conflict.mine === "skip" ? "Skip" : "Clear"})
            </button>
          </p>
        )}
      </div>
    </li>
  );
}

function LabelButton({
  row,
  which,
  saving,
  onPress,
}: {
  row: RadarRow;
  which: "keep" | "skip";
  saving: boolean;
  onPress: (row: RadarRow, pressed: "keep" | "skip") => void;
}) {
  const selected = row.label?.decision === which;
  const word = which === "keep" ? "Keep" : "Skip";
  const base =
    "inline-flex h-7 min-w-[72px] items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:transition-colors motion-safe:duration-[120ms] aria-disabled:cursor-wait max-sm:h-11 max-sm:flex-1";
  const look = selected
    ? which === "keep"
      ? "border border-primary bg-primary text-on-primary"
      : "border border-ink bg-transparent text-ink"
    : "border border-ink-subtle bg-transparent text-ink hover:bg-surface-2";
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-disabled={saving}
      aria-label={`${word}: ${row.title}`}
      onClick={() => !saving && onPress(row, which)}
      className={`${base} ${look}`}
    >
      {selected && <Check />}
      <span aria-hidden="true">{selected ? (which === "keep" ? COPY.kept : COPY.skipped) : word}</span>
    </button>
  );
}

function Check(): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  );
}

function Scores({ row, showUnavailable }: { row: RadarRow; showUnavailable: boolean }) {
  const dash = "–";
  const cell = (label: string, value: string) => (
    <div className="w-[72px]">
      <div className="text-[12px] leading-4 text-ink-subtle">{label}</div>
      <div className="font-mono text-[12px] leading-4 tabular-nums text-ink">{value}</div>
    </div>
  );
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {cell("Fit", row.audienceFit ? row.audienceFit.score.toFixed(2) : dash)}
      {cell("Confidence", row.audienceFit ? row.audienceFit.confidence.toFixed(2) : dash)}
      {cell("Novelty", row.noveltyDistance !== null ? row.noveltyDistance.toFixed(2) : dash)}
      {showUnavailable && row.status === "scored" && row.noveltyDistance === null && (
        <p className="self-end text-[12px] text-ink-subtle">Novelty unavailable</p>
      )}
    </div>
  );
}

// Re-exported for the SSR tests, which render the module's pieces directly.
export const __test = { cohortLabel, relative, sourceCategory };

export type { RadarDay };
