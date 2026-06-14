"use client";

import { useState, useEffect, useRef } from "react";
import {
  Play,
  Check,
  X,
  Loader2,
  Copy,
  Share2,
  RotateCcw,
  ChevronUp,
  Zap,
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
  const [skills, setSkills] = useState<SkillLookup[]>([]);
  const [publishContent, setPublishContent] = useState<string | null>(null);
  const [connectedPlatforms, setConnectedPlatforms] = useState<SocialPlatform[]>([]);
  const [formCollapsed, setFormCollapsed] = useState(false);
  const resultsEndRef = useRef<HTMLDivElement>(null);

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
    setFormCollapsed(false);
  };

  const hasResults = stepResults.length > 0 || status === "running";

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 340px)" }}>
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

      {/* ── Results panel: scrollable ── */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {/* Idle empty state */}
        {status === "idle" && stepResults.length === 0 && (
          <div className="flex h-full items-center justify-center">
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
        {status === "running" && stepResults.length === 0 && !runningStep && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 text-sm text-ink-subtle">Starting workflow</p>
            </div>
          </div>
        )}

        {/* Running: first step starting, no results yet */}
        {status === "running" && stepResults.length === 0 && runningStep && (
          <div className="space-y-3 pb-2">
            <RunningStepIndicator step={runningStep} />
          </div>
        )}

        {/* Step results (streaming in) */}
        {stepResults.length > 0 && (
          <div className="space-y-3 pb-2">
            {stepResults.map((result, i) => (
              <StepResultCard
                key={result.stepId}
                result={result}
                index={i}
                total={runningStep?.total ?? stepResults.length}
                skillName={getSkillName(result.skillId)}
                onPublish={
                  connectedPlatforms.length > 0
                    ? setPublishContent
                    : undefined
                }
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
  onPublish,
}: {
  result: StepResult;
  index: number;
  total: number;
  skillName: string;
  onPublish?: (content: string) => void;
}) {
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const isError = result.status === "error";

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="rounded-lg border border-hairline bg-surface-1 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between bg-surface-2/50 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
              isError
                ? "bg-semantic-error/15 text-semantic-error"
                : "bg-primary/15 text-primary"
            }`}
          >
            {index + 1}
          </div>
          <span className="text-sm font-medium text-ink">{skillName}</span>
          <span className="text-[10px] text-ink-tertiary">
            Step {index + 1} of {total}
          </span>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] text-ink-tertiary">
          <span className="rounded bg-surface-1 px-1.5 py-0.5 font-mono">
            {result.model}
          </span>
          <span>{(result.durationMs / 1000).toFixed(1)}s</span>
          <span>
            {(
              result.usage.inputTokens + result.usage.outputTokens
            ).toLocaleString()}{" "}
            tok
          </span>
        </div>
      </div>

      {/* Error body */}
      {isError && (
        <div className="px-4 py-3">
          <p className="text-sm text-semantic-error">{result.error}</p>
        </div>
      )}

      {/* Output body */}
      {!isError &&
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
                </div>
              </div>
            </div>

            {/* Output content */}
            <div className="px-4 py-4">
              {viewMode === "raw" ? (
                <pre className="max-h-[500px] overflow-auto rounded-md border border-hairline/50 bg-surface-2 p-4 text-xs text-ink-subtle whitespace-pre-wrap font-mono leading-relaxed">
                  {value}
                </pre>
              ) : (
                <div className="max-h-[500px] overflow-auto rounded-md border border-hairline/50 bg-surface-2 p-5 prose prose-sm prose-invert max-w-none [&>h1]:text-base [&>h1]:font-semibold [&>h2]:text-sm [&>h2]:font-semibold [&>h3]:text-sm [&>h3]:font-semibold [&>p]:text-sm [&>p]:leading-relaxed [&>ul]:text-sm [&>ol]:text-sm [&>blockquote]:text-sm [&>blockquote]:border-primary/30">
                  <Markdown>{value}</Markdown>
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
