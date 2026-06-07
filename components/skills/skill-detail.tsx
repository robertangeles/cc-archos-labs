"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ModelSelector } from "./model-selector";
import { OPENROUTER_MODELS } from "@/lib/skills/types";
import { useEnabledModels } from "./use-enabled-models";
import {
  Play,
  Trash2,
  Pencil,
  ArrowLeft,
  Loader2,
  Copy,
  Check,
  Download,
  Clipboard,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Search,
  Zap,
  Gem,
  ClipboardList,
  History,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
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

const CATEGORY_META: Record<string, { icon: LucideIcon; label: string }> = {
  repurpose: { icon: RefreshCw, label: "Repurpose" },
  generate: { icon: Sparkles, label: "Generate" },
  research: { icon: Search, label: "Research" },
  transform: { icon: Zap, label: "Transform" },
  extract: { icon: Gem, label: "Extract" },
  plan: { icon: ClipboardList, label: "Plan" },
};

export function SkillDetail({ skill }: { skill: SkillData }) {
  const router = useRouter();
  const enabledModels = useEnabledModels();
  const [inputValues, setInputValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const inp of skill.inputs) {
      defaults[inp.key] = inp.defaultValue ?? "";
    }
    return defaults;
  });
  const [modelOverride, setModelOverride] = useState(
    skill.defaultModel ?? "anthropic/claude-sonnet-4.6",
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<
    Array<{ id: string; version: number; changelog: string | null; createdAt: string }>
  >([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const outputType = skill.outputs[0]?.type ?? "text";
  const catMeta = CATEGORY_META[skill.category] ?? CATEGORY_META.generate;
  const CatIcon = catMeta.icon;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

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
        router.push("/account/skills");
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

  function handleCopyResult() {
    if (result) {
      navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function exportAsSkillMd() {
    const lines: string[] = [
      "---",
      `name: ${skill.slug}`,
      `description: ${skill.description}`,
      "---",
      "",
    ];
    if (skill.systemPrompt) {
      lines.push("## System Prompt", "", skill.systemPrompt, "");
    }
    if (skill.inputs.length > 0) {
      lines.push("## Inputs", "");
      for (const inp of skill.inputs) {
        lines.push(
          `- **${inp.label}** (\`${inp.key}\`, ${inp.type}${inp.isRequired ? ", required" : ""})${inp.description ? ": " + inp.description : ""}`,
        );
      }
      lines.push("");
    }
    lines.push("## Skill Instructions", "", skill.promptTemplate);

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${skill.slug}.SKILL.md`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  }

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && versions.length === 0) {
      setVersionsLoading(true);
      try {
        const res = await fetch(`/api/skills/${skill.id}/versions`);
        const data = await res.json();
        if (res.ok) setVersions(data.versions ?? []);
      } catch {
        // silent
      } finally {
        setVersionsLoading(false);
      }
    }
  }

  function copyAsPrompt() {
    const parts: string[] = [];
    if (skill.systemPrompt) {
      parts.push(`[System Prompt]\n${skill.systemPrompt}`);
    }
    parts.push(`[Prompt Template]\n${skill.promptTemplate}`);
    if (skill.inputs.length > 0) {
      parts.push(
        `[Inputs]\n${skill.inputs.map((i) => `- ${i.label} ({{${i.key}}}): ${i.description ?? i.type}`).join("\n")}`,
      );
    }
    navigator.clipboard.writeText(parts.join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setMenuOpen(false);
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div>
        {/* Top row: back + name + actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/account/skills")}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink-subtle"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CatIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink">
                {skill.name}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-ink-tertiary">
                  {catMeta.label}
                </span>
                <span className="text-ink-tertiary">&middot;</span>
                <span className="text-[11px] text-ink-tertiary">
                  v{skill.currentVersion}
                </span>
              </div>
            </div>
          </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/account/skills/${skill.id}/edit`}
            className="flex items-center gap-1.5 rounded-md border border-hairline px-3 py-1.5 text-sm text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Link>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-52 rounded-lg border border-hairline bg-surface-2 py-1 shadow-lg shadow-black/30">
                <button
                  type="button"
                  onClick={exportAsSkillMd}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  <Download className="h-4 w-4" />
                  <div>
                    <p className="font-medium">Export SKILL.md</p>
                    <p className="text-[11px] text-ink-tertiary">
                      For Claude Code
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={copyAsPrompt}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  <Clipboard className="h-4 w-4" />
                  <div>
                    <p className="font-medium">Copy prompt</p>
                    <p className="text-[11px] text-ink-tertiary">
                      For Claude.ai or any LLM
                    </p>
                  </div>
                </button>
                <div className="my-1 border-t border-hairline" />
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    handleDelete();
                  }}
                  disabled={deleting}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-semantic-error/80 transition-colors hover:bg-semantic-error/10 hover:text-semantic-error"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete skill
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
        {/* Description below the top row, full width */}
        <p className="mt-2 pl-[4.75rem] text-sm leading-relaxed text-ink-subtle">
          {skill.description}
        </p>
      </div>

      {/* ── Version history (collapsible) ── */}
      <button
        type="button"
        onClick={toggleHistory}
        className="flex items-center gap-1.5 text-[11px] text-ink-tertiary transition-colors hover:text-ink-subtle"
      >
        <History className="h-3 w-3" />
        Version history
        <ChevronDown
          className={`h-3 w-3 transition-transform ${historyOpen ? "rotate-180" : ""}`}
        />
      </button>
      {historyOpen && (
        <div className="rounded-lg border border-hairline bg-surface-1">
          <div className="divide-y divide-hairline">
            {versionsLoading && (
              <div className="px-5 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" />
              </div>
            )}
            {!versionsLoading && versions.length === 0 && (
              <p className="px-5 py-3 text-sm text-ink-tertiary">
                No version history available.
              </p>
            )}
            {versions.map((v) => (
              <div key={v.id} className="flex items-baseline justify-between px-5 py-3">
                <div className="flex items-baseline gap-3">
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-subtle">
                    v{v.version}
                  </span>
                  <span className="text-sm text-ink">
                    {v.changelog || "No changelog"}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] text-ink-tertiary">
                  {new Date(v.createdAt).toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Two-column: inputs | output ── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Left column: inputs + run */}
        <div className="rounded-lg border border-hairline bg-surface-1">
          <div className="border-b border-hairline px-5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
              Inputs
            </p>
          </div>
          <div className="space-y-4 p-5">
            {skill.inputs.map((inp) => (
              <div key={inp.key}>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
                  {inp.label}
                  {inp.isRequired && (
                    <span className="ml-1 text-semantic-error">*</span>
                  )}
                </label>
                {inp.description && (
                  <p className="mt-0.5 text-[10px] text-ink-tertiary">
                    {inp.description}
                  </p>
                )}
                {inp.type === "multiline" ? (
                  <textarea
                    value={inputValues[inp.key] ?? ""}
                    onChange={(e) =>
                      setInputValues({
                        ...inputValues,
                        [inp.key]: e.target.value,
                      })
                    }
                    rows={3}
                    className="mt-1 block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : inp.type === "select" ? (
                  <select
                    value={inputValues[inp.key] ?? ""}
                    onChange={(e) =>
                      setInputValues({
                        ...inputValues,
                        [inp.key]: e.target.value,
                      })
                    }
                    className="mt-1 block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none"
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
                      setInputValues({
                        ...inputValues,
                        [inp.key]: e.target.value,
                      })
                    }
                    className="mt-1 block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
              </div>
            ))}

            {skill.inputs.length === 0 && (
              <p className="py-2 text-sm text-ink-tertiary">
                This skill has no inputs.
              </p>
            )}

            <div className="border-t border-hairline pt-4">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
                Model
              </label>
              <div className="mt-1">
                <ModelSelector
                  value={modelOverride}
                  onChange={setModelOverride}
                  models={enabledModels ?? undefined}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleExecute}
              disabled={executing}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
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

            {error && (
              <p className="text-sm text-semantic-error">{error}</p>
            )}
          </div>
        </div>

        {/* Right column: output */}
        <div className="rounded-lg border border-hairline bg-surface-1">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
              Output
            </p>
            {result && (
              <div className="flex items-center gap-3">
                {resultUsage && (
                  <span className="text-[10px] text-ink-tertiary">
                    {resultUsage.inputTokens + resultUsage.outputTokens} tokens
                    {resultModel && (
                      <>
                        {" "}
                        &middot;{" "}
                        {OPENROUTER_MODELS.find((m) => m.id === resultModel)
                          ?.name ?? resultModel}
                      </>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCopyResult}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-semantic-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
          <div className="max-h-[calc(100vh-280px)] overflow-auto p-5">
            {result ? (
              outputType === "markdown" ? (
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{result}</ReactMarkdown>
                </div>
              ) : outputType === "json" ? (
                <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-4 font-mono text-xs text-ink">
                  {result}
                </pre>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {result}
                </p>
              )
            ) : (
              <div className="flex h-48 flex-col items-center justify-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2">
                  <Play className="h-4 w-4 text-ink-tertiary" />
                </div>
                <p className="mt-3 text-sm text-ink-tertiary">
                  Fill in the inputs and click Run
                </p>
                <p className="mt-1 text-[11px] text-ink-tertiary">
                  Output will appear here
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
