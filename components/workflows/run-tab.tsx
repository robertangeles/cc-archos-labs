"use client";

import { useState, useEffect } from "react";
import { Play, Check, X, Loader2, Copy } from "lucide-react";
import Markdown from "react-markdown";
import type { WorkflowFieldDef, StepResult } from "@/lib/workflows/types";

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

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => setSkills(d.skills ?? []))
      .catch(() => {});
  }, []);

  const getSkillName = (skillId: string) => {
    if (skillId === "raw") return "Raw Prompt";
    return skills.find((s) => s.id === skillId)?.name ?? skillId.slice(0, 8);
  };

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

    try {
      const res = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Execution failed");
        setStatus("failed");
        return;
      }

      setStepResults(data.execution.stepResults);
      setTotalDuration(data.execution.totalDurationMs);
      setStatus(
        data.execution.status === "completed" ? "completed" : "failed",
      );
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
  };

  return (
    <div className="flex gap-6" style={{ height: "calc(100vh - 340px)" }}>
      {/* Left panel: Inputs + Execute */}
      <div className="w-1/3 shrink-0 space-y-4 overflow-y-auto pr-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Run Workflow</h3>
          <p className="mt-0.5 text-[11px] text-ink-tertiary">
            Fill in the inputs and execute.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error}
          </div>
        )}

        <div className="rounded-lg border border-hairline bg-surface-2/50 p-4">
          {fields.length === 0 ? (
            <p className="text-xs text-ink-tertiary">
              No input fields configured.
            </p>
          ) : (
            <div className="space-y-3">
              {fields.map((field) => (
                <FieldInput
                  key={field.id}
                  field={field}
                  value={inputs[field.id] ?? ""}
                  onChange={(val) =>
                    setInputs({ ...inputs, [field.id]: val })
                  }
                  disabled={status === "running"}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={status === "running"}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {status === "running" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Execute
              </>
            )}
          </button>
          {(status === "completed" || status === "failed") && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-hairline px-4 py-2.5 text-sm text-ink-subtle transition-colors hover:bg-surface-2"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Right panel: Results */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {status === "idle" && stepResults.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-ink-tertiary">
              Results will appear here as each step completes.
            </p>
          </div>
        )}

        {status === "running" && stepResults.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-sm text-ink-subtle">
                Executing {stepCount} steps...
              </p>
              <p className="mt-1 text-[11px] text-ink-tertiary">
                This may take a few minutes.
              </p>
            </div>
          </div>
        )}

        {stepResults.map((result, i) => (
          <StepResultCard
            key={result.stepId}
            result={result}
            index={i}
            skillName={getSkillName(result.skillId)}
          />
        ))}

        {totalDuration !== null && (
          <div
            className={`rounded-lg border px-4 py-2.5 text-sm ${
              status === "completed"
                ? "border-green-500/20 bg-green-500/10 text-green-400"
                : "border-red-500/20 bg-red-500/10 text-red-400"
            }`}
          >
            {status === "completed" ? "Completed" : "Failed"} in{" "}
            {(totalDuration / 1000).toFixed(1)}s
          </div>
        )}
      </div>
    </div>
  );
}

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
  const cls =
    "w-full rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50";

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-subtle">
        {field.label}
        {field.required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {field.type === "dropdown" ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cls}
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
          className={cls}
        />
      )}
    </div>
  );
}

function StepResultCard({
  result,
  index,
  skillName,
}: {
  result: StepResult;
  index: number;
  skillName: string;
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
    <div
      className={`rounded-lg border p-4 transition-all ${
        isError
          ? "border-red-500/20 bg-surface-1"
          : "border-green-500/20 bg-surface-1"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isError ? (
            <X className="h-4 w-4 text-red-500" />
          ) : (
            <Check className="h-4 w-4 text-green-500" />
          )}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {index + 1}
          </span>
          <span className="text-sm font-semibold text-ink">{skillName}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-ink-tertiary">
          <span>{result.model}</span>
          <span>{(result.durationMs / 1000).toFixed(1)}s</span>
          <span>
            {result.usage.inputTokens + result.usage.outputTokens} tokens
          </span>
        </div>
      </div>

      {/* Error */}
      {isError && (
        <p className="text-sm text-red-400">{result.error}</p>
      )}

      {/* Outputs - each key rendered separately */}
      {!isError &&
        Object.entries(result.outputs).map(([key, value]) => (
          <div key={key} className="mt-2">
            {/* Output key header with controls */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                {key}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setViewMode("preview")}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    viewMode === "preview"
                      ? "bg-primary/15 text-primary"
                      : "text-ink-tertiary hover:text-ink-subtle"
                  }`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("raw")}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    viewMode === "raw"
                      ? "bg-primary/15 text-primary"
                      : "text-ink-tertiary hover:text-ink-subtle"
                  }`}
                >
                  Raw
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy(key, value)}
                  className="rounded px-1.5 py-0.5 text-ink-tertiary hover:text-primary hover:bg-primary/10 transition-colors"
                  title="Copy to clipboard"
                >
                  {copiedKey === key ? (
                    <Check className="h-3.5 w-3.5 text-green-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Output content */}
            {viewMode === "raw" ? (
              <pre className="max-h-[500px] overflow-auto rounded-lg bg-surface-2 p-4 text-xs text-ink-subtle whitespace-pre-wrap font-mono">
                {value}
              </pre>
            ) : (
              <div className="max-h-[500px] overflow-auto rounded-lg bg-surface-2 border border-hairline p-5 prose prose-sm prose-invert max-w-none [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-sm [&>p]:text-sm [&>ul]:text-sm [&>ol]:text-sm [&>blockquote]:text-sm">
                <Markdown>{value}</Markdown>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
