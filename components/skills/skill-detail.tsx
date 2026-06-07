"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModelSelector } from "./model-selector";
import { OPENROUTER_MODELS } from "@/lib/skills/types";
import {
  Play,
  Trash2,
  ArrowLeft,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

interface SkillInputRow {
  id: string;
  key: string;
  type: string;
  label: string;
  description: string | null;
  isRequired: boolean;
  defaultValue: string | null;
  options: unknown;
}

interface SkillOutputRow {
  key: string;
  type: string;
  label: string;
}

interface SkillData {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  currentVersion: number;
  promptTemplate: string;
  systemPrompt: string | null;
  defaultModel: string | null;
  temperature: string | null;
  maxTokens: number | null;
  inputs: SkillInputRow[];
  outputs: SkillOutputRow[];
  createdAt: string;
  updatedAt: string;
}

export function SkillDetail({ skill }: { skill: SkillData }) {
  const router = useRouter();
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const inp of skill.inputs) {
      defaults[inp.key] = inp.defaultValue ?? "";
    }
    return defaults;
  });
  const [modelOverride, setModelOverride] = useState(
    skill.defaultModel ?? "anthropic/claude-sonnet-4-20250514",
  );
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultModel, setResultModel] = useState<string | null>(null);
  const [resultUsage, setResultUsage] = useState<{
    inputTokens: number;
    outputTokens: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const outputType = skill.outputs[0]?.type ?? "text";

  async function handleExecute() {
    setExecuting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/skills/${skill.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: inputValues,
          model: modelOverride || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Execution failed.");
        return;
      }
      setResult(data.result);
      setResultModel(data.model);
      setResultUsage(data.usage);
    } catch {
      setError("Network error.");
    } finally {
      setExecuting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this skill? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/skills/${skill.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/account");
      } else {
        const data = await res.json();
        setError(data.error ?? "Delete failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setDeleting(false);
    }
  }

  function handleCopy() {
    if (result) {
      navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const modelName =
    OPENROUTER_MODELS.find((m) => m.id === modelOverride)?.name ??
    modelOverride;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-ink-tertiary">
            {skill.category} / v{skill.currentVersion}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">{skill.name}</h2>
          <p className="mt-1 text-sm text-ink-subtle">{skill.description}</p>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="text-ink-tertiary hover:text-semantic-error"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Input form */}
      <div className="mt-6 space-y-4">
        {skill.inputs.length > 0 && (
          <div className="space-y-3">
            {skill.inputs.map((inp) => (
              <div key={inp.key}>
                <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
                  {inp.label}
                  {inp.isRequired && (
                    <span className="ml-1 text-semantic-error">*</span>
                  )}
                </label>
                {inp.description && (
                  <p className="mt-0.5 text-[11px] text-ink-tertiary">
                    {inp.description}
                  </p>
                )}
                {inp.type === "multiline" ? (
                  <textarea
                    value={inputValues[inp.key] ?? ""}
                    onChange={(e) =>
                      setInputValues({ ...inputValues, [inp.key]: e.target.value })
                    }
                    rows={4}
                    className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : inp.type === "select" ? (
                  <select
                    value={inputValues[inp.key] ?? ""}
                    onChange={(e) =>
                      setInputValues({ ...inputValues, [inp.key]: e.target.value })
                    }
                    className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none"
                  >
                    <option value="">Select...</option>
                    {(inp.options as string[] | null)?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={inputValues[inp.key] ?? ""}
                    onChange={(e) =>
                      setInputValues({ ...inputValues, [inp.key]: e.target.value })
                    }
                    className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Model override */}
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
            Model
          </label>
          <div className="mt-1">
            <ModelSelector value={modelOverride} onChange={setModelOverride} />
          </div>
        </div>

        {/* Execute button */}
        <button
          type="button"
          onClick={handleExecute}
          disabled={executing}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {executing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Run Skill
            </>
          )}
        </button>

        {error && <p className="text-sm text-semantic-error">{error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-subtle">
              Output
            </p>
            <div className="flex items-center gap-3">
              {resultUsage && (
                <span className="text-[11px] text-ink-tertiary">
                  {resultUsage.inputTokens + resultUsage.outputTokens} tokens
                  ({resultModel ? OPENROUTER_MODELS.find((m) => m.id === resultModel)?.name ?? resultModel : modelName})
                </span>
              )}
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-ink-subtle hover:text-ink"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-semantic-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <div className="mt-2 rounded-lg border border-hairline bg-surface-1 p-5">
            {outputType === "markdown" ? (
              <div className="prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
            ) : outputType === "json" ? (
              <pre className="overflow-auto whitespace-pre-wrap font-mono text-xs text-ink">
                {result}
              </pre>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-ink">{result}</p>
            )}
          </div>
        </div>
      )}

      {/* Back link */}
      <div className="mt-8">
        <button
          type="button"
          onClick={() => router.push("/account/skills")}
          className="flex items-center gap-1.5 text-sm text-ink-subtle hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to skills
        </button>
      </div>
    </div>
  );
}
