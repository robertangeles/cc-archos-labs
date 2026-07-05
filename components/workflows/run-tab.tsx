"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Check,
  X,
  Loader2,
  Copy,
  Share2,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Zap,
  History,
  ArrowLeft,
} from "lucide-react";
import Markdown from "react-markdown";
import type { WorkflowFieldDef, StepResult } from "@/lib/workflows/types";
import { PublishModal } from "@/components/social/publish-modal";
import type { SocialPlatform } from "@/lib/social/types";
import { SOCIAL_PLATFORMS } from "@/lib/social/types";

interface SkillLookup {
  id: string;
  name: string;
}

interface RunSummary {
  id: string;
  status: string;
  totalDurationMs: number | null;
  createdAt: string;
  inputs: Record<string, string>;
  stepCount: number;
}

interface RunDetail extends RunSummary {
  stepResults: StepResult[];
}

interface RunTabProps {
  workflowId: string;
  fields: WorkflowFieldDef[];
  stepCount: number;
}

type RunStatus = "idle" | "running" | "completed" | "failed";

export function RunTab({ workflowId, fields, stepCount }: RunTabProps) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<RunStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [totalDuration, setTotalDuration] = useState<number | null>(null);
  // The persisted run id of the just-finished live run, so a step can be
  // regenerated straight after running without first opening it from history.
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  // Per-step regenerate state, keyed by the step's index in the run currently on
  // screen (live stepResults OR selectedRun). "regenerating" dims + spins the
  // step while keeping its prior output; "error" shows a dismissible notice and
  // the prior output is untouched (overwrite-only-on-success).
  const [regen, setRegen] = useState<
    Record<number, { phase: "regenerating" | "error"; error?: string }>
  >({});
  const [skills, setSkills] = useState<SkillLookup[]>([]);
  const [publishContent, setPublishContent] = useState<string | null>(null);
  const [connectedPlatforms, setConnectedPlatforms] = useState<SocialPlatform[]>([]);
  const [formCollapsed, setFormCollapsed] = useState(false);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  // Which step's output is expanded. Single-open accordion: only one step
  // shows its (long) output at a time, so you never scroll through earlier
  // steps to reach the one you want.
  //   null = follow the default (the final step — the deliverable)
  //   -1   = explicitly all collapsed
  //   n    = that step is open
  // Derived (not an effect) so the default tracks the latest step as a run
  // streams in, with no set-state-in-effect.
  const [openStep, setOpenStep] = useState<number | null>(null);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(() => {
    fetch(`/api/workflows/${workflowId}/runs`)
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d) => setHistory(d.runs ?? []))
      .catch(() => {});
  }, [workflowId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const openRun = async (runId: string) => {
    setLoadingRun(true);
    // Collapse the input form and the history list so the run's output is
    // what the user sees immediately — the output is why they clicked. The
    // "Past runs" bar stays one click away for switching runs.
    setFormCollapsed(true);
    setHistoryOpen(false);
    // Load a past run fully compacted: every step collapsed (-1), so the user
    // sees the whole pipeline at a glance and expands only what they want.
    setOpenStep(-1);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/runs/${runId}`);
      if (!res.ok) return;
      const data = await res.json();
      setSelectedRun(data.run ?? null);
    } catch {
      // ignore — viewing history is best-effort
    } finally {
      setLoadingRun(false);
    }
  };

  // Make history actionable: drop a past run's inputs back into the form so the
  // next run is one click away. This is the loop that brings people back.
  const restoreInputs = (runInputs: Record<string, string>) => {
    setInputs({ ...runInputs });
    setSelectedRun(null);
    setError(null);
    setFormCollapsed(false);
  };

  // The headline that makes one run recognisable from another: the first
  // non-empty input the user actually typed, in field order.
  const runHeadline = (runInputs: Record<string, string>): string => {
    for (const f of fields) {
      const v = runInputs[f.id]?.trim();
      if (v) return v;
    }
    const any = Object.values(runInputs)
      .map((v) => String(v ?? "").trim())
      .find(Boolean);
    return any ?? "Untitled run";
  };

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => setSkills(d.skills ?? []))
      .catch(() => {});
    Promise.all(
      SOCIAL_PLATFORMS.map((p) =>
        fetch(`/api/social/${p}/status`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => (d?.connected ? p : null))
          .catch(() => null),
      ),
    ).then((results) => {
      setConnectedPlatforms(
        results.filter((p): p is SocialPlatform => p !== null),
      );
    });
  }, []);

  const getSkillName = (skillId: string) => {
    if (skillId === "raw") return "Raw Prompt";
    return skills.find((s) => s.id === skillId)?.name ?? skillId.slice(0, 8);
  };

  const [runningStep, setRunningStep] = useState<{
    index: number;
    total: number;
    skillName: string;
  } | null>(null);

  const handleRun = async () => {
    if (stepCount === 0) {
      setError("No steps configured. Add skills in the Steps section first.");
      return;
    }
    for (const field of fields) {
      if (field.required && !inputs[field.id]?.trim()) {
        setError(`Required field "${field.label}" is empty.`);
        return;
      }
    }
    setStatus("running");
    setError(null);
    setStepResults([]);
    setTotalDuration(null);
    setRunningStep(null);
    setLiveRunId(null);
    setRegen({});
    setSelectedRun(null);
    setOpenStep(null);
    setFormCollapsed(true);

    try {
      const res = await fetch(`/api/workflows/${workflowId}/execute-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Execution failed");
        setStatus("failed");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("Streaming not supported");
        setStatus("failed");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6);
          try {
            const event = JSON.parse(json);
            if (event.type === "step_start") {
              setRunningStep({
                index: event.index,
                total: event.total,
                skillName: event.skillName,
              });
            } else if (event.type === "step_result") {
              setStepResults((prev) => [...prev, event.result]);
              setRunningStep(null);
              setTimeout(() => {
                resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
              }, 50);
            } else if (event.type === "done") {
              setTotalDuration(event.totalDurationMs);
              setStatus(event.status === "completed" ? "completed" : "failed");
              setRunningStep(null);
              setLiveRunId(event.runId ?? null);
              loadHistory();
            } else if (event.type === "error") {
              setError(event.error);
              setStatus("failed");
              setRunningStep(null);
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch {
      setError("Connection failed. Try again.");
      setStatus("failed");
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setError(null);
    setStepResults([]);
    setTotalDuration(null);
    setLiveRunId(null);
    setRegen({});
    setFormCollapsed(false);
  };

  const clearRegen = (stepIndex: number) =>
    setRegen((p) => {
      const next = { ...p };
      delete next[stepIndex];
      return next;
    });

  // Regenerate one step of a persisted run. Streams the amend and patches the
  // step in whichever run is on screen (live or a replayed one). A failed
  // regenerate leaves the prior output in place — the server never overwrites
  // it — so we only surface the error, never blank the card.
  const regenerateStep = async (
    runId: string,
    stepIndex: number,
    stepId: string,
    opts: { feedback?: string; rerunDownstream: boolean },
  ) => {
    const patch = (idx: number, next: StepResult) => {
      setStepResults((prev) =>
        prev.length > idx ? prev.map((r, i) => (i === idx ? next : r)) : prev,
      );
      setSelectedRun((prev) =>
        prev
          ? { ...prev, stepResults: prev.stepResults.map((r, i) => (i === idx ? next : r)) }
          : prev,
      );
    };
    const markStale = (idxs: number[]) => {
      const set = new Set(idxs);
      const mapStale = (r: StepResult, i: number) =>
        set.has(i) ? { ...r, isStale: true } : r;
      setStepResults((prev) => prev.map(mapStale));
      setSelectedRun((prev) =>
        prev ? { ...prev, stepResults: prev.stepResults.map(mapStale) } : prev,
      );
    };

    setRegen((p) => ({ ...p, [stepIndex]: { phase: "regenerating" } }));
    try {
      const res = await fetch(
        `/api/workflows/${workflowId}/runs/${runId}/steps/${stepId}/regenerate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRegen((p) => ({
          ...p,
          [stepIndex]: {
            phase: "error",
            error: (data as { error?: string }).error ?? "Regeneration failed.",
          },
        }));
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setRegen((p) => ({ ...p, [stepIndex]: { phase: "error", error: "Streaming not supported." } }));
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "step_result") {
              patch(ev.stepIndex, ev.result);
              clearRegen(ev.stepIndex);
            } else if (ev.type === "step_error") {
              setRegen((p) => ({ ...p, [ev.stepIndex]: { phase: "error", error: ev.error } }));
            } else if (ev.type === "stale") {
              markStale(ev.stepIndexes ?? []);
            } else if (ev.type === "done") {
              clearRegen(stepIndex);
              loadHistory();
            } else if (ev.type === "error") {
              setRegen((p) => ({ ...p, [stepIndex]: { phase: "error", error: ev.error } }));
            }
          } catch {
            /* skip malformed lines */
          }
        }
      }
    } catch {
      setRegen((p) => ({ ...p, [stepIndex]: { phase: "error", error: "Connection failed. Try again." } }));
    }
  };

  const hasResults =
    stepResults.length > 0 || status === "running" || !!selectedRun;

  // Resolve the effective open step per context. openStep === null means
  // "default to the last step" (the deliverable / latest-as-it-streams).
  const liveOpenStep =
    openStep === null ? stepResults.length - 1 : openStep;
  const historyOpenStep =
    openStep === null
      ? selectedRun
        ? selectedRun.stepResults.length - 1
        : -1
      : openStep;

  return (
    <div className="flex flex-col">
      {/* ── Command bar: inputs + execute ── */}
      <div className="shrink-0">
        {/* Collapsed state: slim bar */}
        {formCollapsed && (
          <button
            type="button"
            onClick={() => setFormCollapsed(false)}
            className="group flex w-full items-center justify-between rounded-lg border border-hairline bg-surface-2/60 px-4 py-2.5 text-left transition-all hover:border-primary/30 hover:bg-surface-2"
          >
            <div className="flex items-center gap-3">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-ink-subtle">
                {fields
                  .filter((f) => inputs[f.id]?.trim())
                  .map((f) => inputs[f.id]!.slice(0, 40))
                  .join(" · ") || "No inputs"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {status === "running" && (
                <span className="flex items-center gap-1.5 text-[11px] text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Running
                </span>
              )}
              {status === "completed" && totalDuration !== null && (
                <span className="text-[11px] text-semantic-success">
                  Done in {(totalDuration / 1000).toFixed(1)}s
                </span>
              )}
              {status === "failed" && (
                <span className="text-[11px] text-semantic-error">Failed</span>
              )}
              <ChevronUp className="h-3.5 w-3.5 text-ink-tertiary transition-transform group-hover:text-ink-subtle" />
            </div>
          </button>
        )}

        {/* Expanded state: full form */}
        {!formCollapsed && (
          <div className="rounded-lg border border-hairline bg-surface-2/40">
            {error && (
              <div className="mx-4 mt-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-xs text-semantic-error">
                {error}
              </div>
            )}

            <div className="p-4">
              {fields.length === 0 ? (
                <p className="py-2 text-xs text-ink-tertiary">
                  No input fields configured.
                </p>
              ) : (
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  {fields.map((field) => (
                    <div
                      key={field.id}
                      className={
                        field.type === "multiline" ? "sm:col-span-2" : ""
                      }
                    >
                      <FieldInput
                        field={field}
                        value={inputs[field.id] ?? ""}
                        onChange={(val) =>
                          setInputs({ ...inputs, [field.id]: val })
                        }
                        disabled={status === "running"}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action row */}
            <div className="flex items-center justify-between border-t border-hairline/50 px-4 py-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={status === "running"}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-on-primary transition-all hover:bg-primary-hover disabled:opacity-50"
                >
                  {status === "running" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      Execute
                    </>
                  )}
                </button>
                {(status === "completed" || status === "failed") && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-xs font-medium text-ink-subtle transition-colors hover:bg-surface-1 hover:text-ink"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </button>
                )}
              </div>
              {hasResults && (
                <button
                  type="button"
                  onClick={() => setFormCollapsed(true)}
                  className="text-[11px] text-ink-tertiary hover:text-ink-subtle transition-colors"
                >
                  Collapse
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Past runs ── */}
      {history.length > 0 && (
        <div className="mt-3 shrink-0">
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            className="group flex w-full items-center justify-between rounded-lg border border-hairline bg-surface-2/40 px-4 py-2 text-left transition-colors hover:border-primary/30 hover:bg-surface-2"
          >
            <div className="flex items-center gap-2.5">
              <History className="h-3.5 w-3.5 text-ink-tertiary" />
              <span className="text-xs font-medium text-ink-subtle">
                Past runs
              </span>
              <span className="rounded bg-surface-1 px-1.5 py-0.5 text-[10px] text-ink-tertiary">
                {history.length}
              </span>
            </div>
            {historyOpen ? (
              <ChevronUp className="h-3.5 w-3.5 text-ink-tertiary group-hover:text-ink-subtle" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-ink-tertiary group-hover:text-ink-subtle" />
            )}
          </button>

          {historyOpen && (
            <div className="mt-1.5 max-h-64 space-y-1 overflow-y-auto pr-1">
              {history.map((run, idx) => {
                const isSelected = selectedRun?.id === run.id;
                const ok = run.status === "completed";
                return (
                  <div
                    key={run.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openRun(run.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openRun(run.id);
                      }
                    }}
                    className={`group/run relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-md border pl-3 pr-2 py-2 text-left transition-all ${
                      isSelected
                        ? "border-primary/40 bg-primary/5"
                        : "border-hairline/60 bg-surface-1 hover:border-primary/30 hover:bg-surface-2"
                    }`}
                  >
                    {/* Status accent rail */}
                    <span
                      className={`absolute inset-y-0 left-0 w-0.5 ${
                        ok ? "bg-semantic-success/70" : "bg-semantic-error/70"
                      }`}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {idx === 0 && (
                          <span className="shrink-0 rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
                            Latest
                          </span>
                        )}
                        <span className="truncate text-xs font-medium text-ink">
                          {runHeadline(run.inputs)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-tertiary">
                        <span className={ok ? "" : "text-semantic-error"}>
                          {ok ? "Completed" : "Failed"}
                        </span>
                        <span aria-hidden>·</span>
                        <span>{relativeTime(run.createdAt)}</span>
                        <span aria-hidden>·</span>
                        <span>
                          {run.stepCount} step{run.stepCount !== 1 ? "s" : ""}
                        </span>
                        {run.totalDurationMs !== null && (
                          <>
                            <span aria-hidden>·</span>
                            <span>{(run.totalDurationMs / 1000).toFixed(1)}s</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Re-use action — the loop back to the next run */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        restoreInputs(run.inputs);
                      }}
                      title="Load these inputs into the form"
                      className="shrink-0 inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-[10px] font-medium text-ink-tertiary opacity-0 transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary group-hover/run:opacity-100 focus:opacity-100"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Use inputs
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Results panel: flows with the page (single scroll) ── */}
      <div className="mt-3">
        {/* Viewing a past run */}
        {selectedRun && (
          <div className="space-y-3 pb-2">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <History className="h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-ink">
                    {runHeadline(selectedRun.inputs)}
                  </div>
                  <div className="text-[10px] text-ink-tertiary">
                    {runWhen(selectedRun.createdAt)}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => restoreInputs(selectedRun.inputs)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-on-primary transition-colors hover:bg-primary-hover"
                >
                  <RotateCcw className="h-3 w-3" />
                  Use inputs
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRun(null);
                    setOpenStep(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1 text-[11px] font-medium text-ink-subtle transition-colors hover:bg-surface-1 hover:text-ink"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to live
                </button>
              </div>
            </div>
            {selectedRun.stepResults.map((result, i) => (
              <StepResultCard
                key={`${selectedRun.id}-${result.stepId}`}
                result={result}
                index={i}
                total={selectedRun.stepResults.length}
                skillName={getSkillName(result.skillId)}
                isOpen={historyOpenStep === i}
                onToggle={() =>
                  setOpenStep(historyOpenStep === i ? -1 : i)
                }
                onPublish={
                  connectedPlatforms.length > 0 ? setPublishContent : undefined
                }
                isLastStep={i === selectedRun.stepResults.length - 1}
                onRegenerate={(opts) =>
                  regenerateStep(selectedRun.id, i, result.stepId, opts)
                }
                regenPhase={regen[i]?.phase}
                regenError={regen[i]?.error}
                onDismissRegenError={() => clearRegen(i)}
              />
            ))}
          </div>
        )}

        {/* Loading a past run */}
        {loadingRun && !selectedRun && (
          <div className="flex min-h-[340px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {/* Idle empty state */}
        {!selectedRun && !loadingRun && status === "idle" && stepResults.length === 0 && (
          <div className="flex min-h-[340px] items-center justify-center">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-hairline-strong bg-surface-1">
                <Play className="h-5 w-5 text-ink-tertiary" />
              </div>
              <p className="mt-4 text-sm text-ink-subtle">
                Ready to execute
              </p>
              <p className="mt-1 text-[11px] text-ink-tertiary">
                {stepCount} step{stepCount !== 1 ? "s" : ""} configured. Fill in
                the inputs and hit Execute.
              </p>
            </div>
          </div>
        )}

        {/* Running: initial spinner before first step arrives */}
        {!selectedRun && status === "running" && stepResults.length === 0 && !runningStep && (
          <div className="flex min-h-[340px] items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 text-sm text-ink-subtle">Starting workflow</p>
            </div>
          </div>
        )}

        {/* Running: first step starting, no results yet */}
        {!selectedRun && status === "running" && stepResults.length === 0 && runningStep && (
          <div className="space-y-3 pb-2">
            <RunningStepIndicator step={runningStep} />
          </div>
        )}

        {/* Step results (streaming in) */}
        {!selectedRun && stepResults.length > 0 && (
          <div className="space-y-3 pb-2">
            {stepResults.map((result, i) => (
              <StepResultCard
                key={result.stepId}
                result={result}
                index={i}
                total={runningStep?.total ?? stepResults.length}
                skillName={getSkillName(result.skillId)}
                isOpen={liveOpenStep === i}
                onToggle={() => setOpenStep(liveOpenStep === i ? -1 : i)}
                onPublish={
                  connectedPlatforms.length > 0
                    ? setPublishContent
                    : undefined
                }
                isLastStep={i === stepResults.length - 1}
                onRegenerate={
                  status !== "running" && liveRunId
                    ? (opts) => regenerateStep(liveRunId, i, result.stepId, opts)
                    : undefined
                }
                regenPhase={regen[i]?.phase}
                regenError={regen[i]?.error}
                onDismissRegenError={() => clearRegen(i)}
              />
            ))}

            {/* Currently running step indicator */}
            {status === "running" && runningStep && (
              <RunningStepIndicator step={runningStep} />
            )}

            {/* Summary bar */}
            {totalDuration !== null && (
              <div
                className={`flex items-center gap-3 rounded-lg px-4 py-3 ${
                  status === "completed"
                    ? "bg-semantic-success/8 border border-semantic-success/15"
                    : "bg-semantic-error/8 border border-semantic-error/15"
                }`}
              >
                {status === "completed" ? (
                  <Check className="h-4 w-4 text-semantic-success" />
                ) : (
                  <X className="h-4 w-4 text-semantic-error" />
                )}
                <span
                  className={`text-sm font-medium ${
                    status === "completed"
                      ? "text-semantic-success"
                      : "text-semantic-error"
                  }`}
                >
                  {status === "completed"
                    ? "All steps completed"
                    : "Execution failed"}
                </span>
                <span className="text-[11px] text-ink-tertiary">
                  {(totalDuration / 1000).toFixed(1)}s &middot;{" "}
                  {stepResults.length} step
                  {stepResults.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
            <div ref={resultsEndRef} />
          </div>
        )}
      </div>

      {publishContent && connectedPlatforms.length > 0 && (
        <PublishModal
          defaultContent={publishContent}
          connectedPlatforms={connectedPlatforms}
          onClose={() => setPublishContent(null)}
          onPublished={() => setPublishContent(null)}
          onScheduled={() => setPublishContent(null)}
        />
      )}
    </div>
  );
}

/* ── Helpers ── */

function formatRunTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown time";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Relative time keeps the panel feeling alive ("2m ago" beats a dead
// timestamp). Falls back to the absolute date once a run is a week old.
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return formatRunTime(iso);
}

// "2m ago · Jun 14, 1:15 PM" — but collapse to a single value once the run is
// old enough that relativeTime has already fallen back to the absolute date.
function runWhen(iso: string): string {
  const rel = relativeTime(iso);
  const abs = formatRunTime(iso);
  return rel === abs ? abs : `${rel} · ${abs}`;
}

/* ── Field input ── */

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: WorkflowFieldDef;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium tracking-wide text-ink-subtle">
        {field.label}
        {field.required && (
          <span className="ml-0.5 text-primary">*</span>
        )}
      </label>
      {field.type === "dropdown" ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink transition-colors focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
        >
          <option value="">Select...</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={field.type === "multiline" ? 4 : 2}
          disabled={disabled}
          className="w-full resize-none rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary transition-colors focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
        />
      )}
    </div>
  );
}

/* ── Step result card ── */

function StepResultCard({
  result,
  index,
  total,
  skillName,
  isOpen,
  onToggle,
  onPublish,
  isLastStep,
  onRegenerate,
  regenPhase,
  regenError,
  onDismissRegenError,
}: {
  result: StepResult;
  index: number;
  total: number;
  skillName: string;
  isOpen: boolean;
  onToggle: () => void;
  onPublish?: (content: string) => void;
  isLastStep?: boolean;
  // Undefined when the step can't be regenerated (run still streaming, or no
  // persisted run id yet). Present → the Regenerate control is shown.
  onRegenerate?: (opts: { feedback?: string; rerunDownstream: boolean }) => void;
  regenPhase?: "regenerating" | "error";
  regenError?: string;
  onDismissRegenError?: () => void;
}) {
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Progressive disclosure: the toolbar shows one Regenerate icon; the feedback
  // textarea + rerun-downstream toggle live in a popover opened from it.
  const [regenOpen, setRegenOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [rerunDownstream, setRerunDownstream] = useState(false);
  const regenPopoverRef = useRef<HTMLDivElement>(null);
  const isError = result.status === "error";
  const isRegenerating = regenPhase === "regenerating";
  const isStale = result.isStale === true;

  // Close the popover on Escape or an outside click (a11y + expected behaviour).
  useEffect(() => {
    if (!regenOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRegenOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (regenPopoverRef.current && !regenPopoverRef.current.contains(e.target as Node)) {
        setRegenOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [regenOpen]);

  const submitRegen = () => {
    if (!onRegenerate) return;
    onRegenerate({
      feedback: feedback.trim() || undefined,
      rerunDownstream,
    });
    setRegenOpen(false);
    setFeedback("");
  };

  // One-line preview shown when the step is collapsed, so each step is
  // recognisable without expanding it. Strip markdown noise to plain text.
  const firstValue = Object.values(result.outputs)[0] ?? "";
  const preview = isError
    ? result.error ?? "Step failed"
    : firstValue.replace(/[#*_`>[\]]/g, "").replace(/\s+/g, " ").trim();

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="rounded-lg border border-hairline bg-surface-1 overflow-hidden">
      {/* Card header — click to expand/collapse this step's output */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 bg-surface-2/50 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-ink-tertiary transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
          />
          <div
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
              isError
                ? "bg-semantic-error/15 text-semantic-error"
                : "bg-primary/15 text-primary"
            }`}
          >
            {index + 1}
          </div>
          <span className="shrink-0 text-sm font-medium text-ink">
            {skillName}
          </span>
          {isOpen ? (
            <span className="shrink-0 text-[10px] text-ink-tertiary">
              Step {index + 1} of {total}
            </span>
          ) : (
            preview && (
              <span
                className={`truncate text-xs ${
                  isError ? "text-semantic-error/80" : "text-ink-tertiary"
                }`}
              >
                {preview}
              </span>
            )
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5 text-[10px] text-ink-tertiary">
          <span className="hidden font-mono sm:inline rounded bg-surface-1 px-1.5 py-0.5">
            {result.model}
          </span>
          <span>{(result.durationMs / 1000).toFixed(1)}s</span>
          {isError ? (
            <span className="text-semantic-error">failed</span>
          ) : (
            <span className="hidden sm:inline">
              {(
                result.usage.inputTokens + result.usage.outputTokens
              ).toLocaleString()}{" "}
              tok
            </span>
          )}
        </div>
      </button>

      {/* D1 — transient regenerate error. Dismissible, aria-live, and shown on
          the NORMAL surface: the prior good output is kept (overwrite-only-on-
          success), so we never use the red failed-step treatment here. */}
      {regenError && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 border-t border-hairline/50 bg-surface-2/40 px-4 py-2.5"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-semantic-error" />
          <p className="flex-1 text-xs text-semantic-error">{regenError}</p>
          {onDismissRegenError && (
            <button
              type="button"
              onClick={onDismissRegenError}
              aria-label="Dismiss"
              className="-m-1 flex h-6 w-6 items-center justify-center rounded text-ink-tertiary transition-colors hover:text-ink-subtle"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* E4 — downstream stale. An earlier step was regenerated without a
          cascade, so this output is out of date. No warning colour (single-
          accent rule) — a quiet label plus a rerun affordance. */}
      {isStale && !isError && (
        <div className="flex items-center gap-2 border-t border-hairline/50 bg-surface-2/40 px-4 py-2">
          <span className="flex-1 text-[11px] text-ink-tertiary">
            Outdated — based on a previous version of an earlier step.
          </span>
          {onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate({ rerunDownstream: true })}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1 text-[11px] font-medium text-ink-subtle transition-colors hover:bg-surface-1 hover:text-ink"
            >
              <RefreshCw className="h-3 w-3" />
              Rerun from here
            </button>
          )}
        </div>
      )}

      {/* Error body */}
      {isOpen && isError && (
        <div className="border-t border-hairline/50 px-4 py-3">
          <p className="text-sm text-semantic-error">{result.error}</p>
        </div>
      )}

      {/* Output body */}
      {isOpen &&
        !isError &&
        Object.entries(result.outputs).map(([key, value]) => (
          <div key={key} className="border-t border-hairline/50">
            {/* Output toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-surface-2/30">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-tertiary">
                {key}
              </span>
              <div className="flex items-center">
                <div className="flex rounded-md border border-hairline overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setViewMode("preview")}
                    className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                      viewMode === "preview"
                        ? "bg-primary/15 text-primary"
                        : "text-ink-tertiary hover:text-ink-subtle hover:bg-surface-1"
                    }`}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("raw")}
                    className={`border-l border-hairline px-2.5 py-1 text-[10px] font-medium transition-colors ${
                      viewMode === "raw"
                        ? "bg-primary/15 text-primary"
                        : "text-ink-tertiary hover:text-ink-subtle hover:bg-surface-1"
                    }`}
                  >
                    Raw
                  </button>
                </div>
                <div className="ml-2 flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleCopy(key, value)}
                    className="rounded-md p-1.5 text-ink-tertiary transition-colors hover:bg-surface-1 hover:text-ink-subtle"
                    title="Copy"
                  >
                    {copiedKey === key ? (
                      <Check className="h-3.5 w-3.5 text-semantic-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {onPublish && (
                    <button
                      type="button"
                      onClick={() => onPublish(value)}
                      className="rounded-md p-1.5 text-ink-tertiary transition-colors hover:bg-primary/10 hover:text-primary"
                      title="Publish to social"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* D2 — Regenerate: one ghost icon (peer of Copy/Publish),
                      progressive-disclosure popover holds feedback + cascade. */}
                  {onRegenerate && (
                    <div ref={regenPopoverRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setRegenOpen((o) => !o)}
                        disabled={isRegenerating}
                        aria-label="Regenerate this step"
                        aria-expanded={regenOpen}
                        title="Regenerate"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-1 hover:text-ink-subtle disabled:opacity-50"
                      >
                        {isRegenerating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {regenOpen && (
                        <div className="absolute right-0 top-9 z-20 w-72 rounded-lg border border-hairline bg-surface-1 p-3 shadow-lg">
                          <label
                            htmlFor={`regen-fb-${result.stepId}`}
                            className="block text-[11px] font-medium text-ink-subtle"
                          >
                            What was wrong?{" "}
                            <span className="text-ink-tertiary">(optional)</span>
                          </label>
                          <textarea
                            id={`regen-fb-${result.stepId}`}
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value.slice(0, 10000))}
                            rows={3}
                            autoFocus
                            placeholder="e.g. too formal, missing the call to action…"
                            className="mt-1.5 w-full resize-none rounded-md border border-hairline bg-surface-2 px-2.5 py-2 text-xs text-ink placeholder:text-ink-tertiary focus:border-primary/50 focus:outline-none"
                          />
                          <div className="mt-1 text-right text-[10px] text-ink-tertiary">
                            {feedback.length}/10000
                          </div>
                          {!isLastStep && (
                            <label className="mt-1 flex items-center gap-2 text-[11px] text-ink-subtle">
                              <input
                                type="checkbox"
                                checked={rerunDownstream}
                                onChange={(e) => setRerunDownstream(e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-hairline"
                              />
                              Also rerun the following steps
                            </label>
                          )}
                          <button
                            type="button"
                            onClick={submitRegen}
                            className="mt-3 flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-on-primary transition-colors hover:bg-primary-hover"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Regenerate
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Output content. Dimmed while regenerating (prior output stays
                visible, never blanked) or when stale. */}
            <div className="relative px-4 py-4">
              <div
                className={
                  isRegenerating || isStale ? "opacity-60 transition-opacity" : "transition-opacity"
                }
              >
                {viewMode === "raw" ? (
                  <pre className="rounded-md border border-hairline/50 bg-surface-2 p-4 text-xs text-ink-subtle whitespace-pre-wrap font-mono leading-relaxed">
                    {value}
                  </pre>
                ) : (
                  <div className="rounded-md border border-hairline/50 bg-surface-2 p-5 prose prose-sm prose-invert max-w-none [&>h1]:text-base [&>h1]:font-semibold [&>h2]:text-sm [&>h2]:font-semibold [&>h3]:text-sm [&>h3]:font-semibold [&>p]:text-sm [&>p]:leading-relaxed [&>ul]:text-sm [&>ol]:text-sm [&>blockquote]:text-sm [&>blockquote]:border-primary/30">
                    <Markdown>{value}</Markdown>
                  </div>
                )}
              </div>
              {isRegenerating && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-1/90 px-3 py-1.5 text-[11px] text-ink-subtle">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    Regenerating…
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}

function RunningStepIndicator({
  step,
}: {
  step: { index: number; total: number; skillName: string };
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span className="text-sm text-ink-subtle">
        Running step {step.index + 1} of {step.total}
      </span>
      <span className="text-sm font-medium text-ink">{step.skillName}</span>
    </div>
  );
}
