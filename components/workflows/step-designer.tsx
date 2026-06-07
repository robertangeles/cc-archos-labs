"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, ArrowUp, ArrowDown, X, Zap } from "lucide-react";
import { ModelSelector } from "@/components/skills/model-selector";
import type {
  WorkflowStepDef,
  WorkflowFieldDef,
  EditorConfig,
} from "@/lib/workflows/types";

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface SkillInput {
  key: string;
  type: string;
  label: string;
  isRequired: boolean;
  defaultValue: string | null;
}

interface SkillOutput {
  key: string;
  type: string;
  label: string;
}

interface SkillDetail {
  id: string;
  name: string;
  description: string;
  inputs: SkillInput[];
  outputs: SkillOutput[];
  defaultModel: string | null;
  promptTemplate: string | null;
}

interface StepDesignerProps {
  steps: WorkflowStepDef[];
  fields: WorkflowFieldDef[];
  onStepsChange: (steps: WorkflowStepDef[]) => void;
}

export function StepDesigner({
  steps,
  fields,
  onStepsChange,
}: StepDesignerProps) {
  const [local, setLocal] = useState<WorkflowStepDef[]>(steps);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillDetails, setSkillDetails] = useState<Record<string, SkillDetail>>({});
  const [showPicker, setShowPicker] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => setSkills(d.skills ?? []))
      .catch(() => {});
  }, []);

  const loadSkillDetail = useCallback(async (skillId: string) => {
    if (skillDetails[skillId]) return;
    try {
      const res = await fetch(`/api/skills/${skillId}`);
      if (res.ok) {
        const data = await res.json();
        setSkillDetails((prev) => ({ ...prev, [skillId]: data.skill }));
      }
    } catch {
      // non-blocking
    }
  }, [skillDetails]);

  useEffect(() => {
    local.forEach((s) => {
      if (s.skillId) loadSkillDetail(s.skillId);
    });
  }, [local, loadSkillDetail]);

  const save = useCallback(
    (updated: WorkflowStepDef[]) => {
      setLocal(updated);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onStepsChange(updated), 400);
    },
    [onStepsChange],
  );

  const addStep = (skill: SkillSummary) => {
    const newStep: WorkflowStepDef = {
      id: uid(),
      skillId: skill.id,
      provider: "",
      model: "",
      prompt: "",
      capabilities: [],
      inputMappings: {},
      order: local.length,
    };
    save([...local, newStep]);
    setShowPicker(false);
  };

  const addRawStep = () => {
    save([
      ...local,
      {
        id: uid(),
        provider: "",
        model: "",
        prompt: "",
        capabilities: [],
        order: local.length,
      },
    ]);
  };

  const updateStep = (i: number, updates: Partial<WorkflowStepDef>) => {
    save(local.map((s, idx) => (idx === i ? { ...s, ...updates } : s)));
  };

  const removeStep = (i: number) => {
    save(
      local
        .filter((_, idx) => idx !== i)
        .map((s, idx) => ({ ...s, order: idx })),
    );
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= local.length) return;
    const a = [...local];
    [a[i], a[t]] = [a[t], a[i]];
    save(a.map((s, idx) => ({ ...s, order: idx })));
  };

  const getSkillName = (skillId?: string) => {
    if (!skillId) return "Raw Prompt";
    return skills.find((s) => s.id === skillId)?.name ?? "Unknown Skill";
  };

  const getInputSources = (stepIndex: number) => {
    const sources: Array<{ value: string; label: string }> = [];
    fields.forEach((f) => {
      sources.push({ value: f.id, label: `Field: ${f.label || f.id}` });
    });
    local.slice(0, stepIndex).forEach((s, si) => {
      const detail = s.skillId ? skillDetails[s.skillId] : null;
      if (detail?.outputs && detail.outputs.length > 0) {
        detail.outputs.forEach((out) => {
          sources.push({
            value: `step_${s.id}.${out.key}`,
            label: `Step ${si + 1}: ${out.label} (${out.key})`,
          });
        });
      } else {
        sources.push({
          value: `step_${s.id}.result`,
          label: `Step ${si + 1}: ${getSkillName(s.skillId)} output`,
        });
      }
    });
    return sources;
  };

  if (showPicker) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-ink">Select a Skill</p>
          <button
            type="button"
            onClick={() => setShowPicker(false)}
            className="text-xs text-ink-subtle hover:text-ink"
          >
            Cancel
          </button>
        </div>
        {skills.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-tertiary">
            No skills available. Create skills first in the Skills tab.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {skills.map((sk) => (
              <button
                key={sk.id}
                type="button"
                onClick={() => addStep(sk)}
                className="rounded-lg border border-hairline bg-surface-1 p-3 text-left transition-colors hover:border-primary/30 hover:bg-surface-2"
              >
                <p className="text-sm font-medium text-ink">{sk.name}</p>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-ink-subtle">
                  {sk.description}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ink">Pipeline Steps</p>
          <p className="text-[11px] text-ink-tertiary">
            Chain skills together to process content.
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-3 w-3" />
            Add Step
          </button>
          <button
            type="button"
            onClick={addRawStep}
            className="inline-flex items-center gap-1 rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-ink-subtle transition-colors hover:bg-surface-1"
          >
            <Zap className="h-3 w-3" />
            Raw Prompt
          </button>
        </div>
      </div>

      {local.length === 0 && (
        <p className="py-4 text-center text-xs text-ink-tertiary">
          No steps yet. Add a skill or raw prompt step.
        </p>
      )}

      {local.map((step, i) => {
        const detail = step.skillId ? skillDetails[step.skillId] : null;
        const skillInputs = detail?.inputs ?? [];
        const sources = getInputSources(i);

        return (
          <div
            key={step.id}
            className="space-y-3 rounded-lg border border-hairline bg-surface-2/50 p-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <span className="text-sm font-semibold text-ink">
                  {getSkillName(step.skillId)}
                </span>
              </div>
              <div className="flex gap-0.5">
                <button
                  type="button"
                  onClick={() => moveStep(i, -1)}
                  disabled={i === 0}
                  className="rounded p-1 text-ink-tertiary hover:bg-surface-2 disabled:opacity-30"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(i, 1)}
                  disabled={i === local.length - 1}
                  className="rounded p-1 text-ink-tertiary hover:bg-surface-2 disabled:opacity-30"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  className="rounded p-1 text-red-500 hover:bg-red-500/10"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Model selector */}
            <div>
              <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
                Model
              </label>
              <ModelSelector
                value={step.model}
                onChange={(model) => updateStep(i, { model })}
              />
            </div>

            {/* Raw prompt (non-skill steps only) */}
            {!step.skillId && (
              <div>
                <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
                  Prompt
                </label>
                <textarea
                  value={step.prompt}
                  onChange={(e) => updateStep(i, { prompt: e.target.value })}
                  placeholder="Enter your prompt. Use {{field_id}} for variable substitution."
                  rows={4}
                  className="w-full rounded-md border border-hairline bg-surface-1 px-2 py-1.5 text-xs text-ink placeholder:text-ink-tertiary focus:border-primary/40 focus:outline-none"
                />
              </div>
            )}

            {/* Per-skill input mappings */}
            {skillInputs.length > 0 && (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-ink-subtle">
                  Input Mappings
                </label>
                <div className="space-y-1.5">
                  {skillInputs.map((inp) => (
                    <div
                      key={inp.key}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="w-28 shrink-0 truncate font-mono text-ink-subtle" title={inp.key}>
                        {inp.key}
                      </span>
                      <span className="text-ink-tertiary">&larr;</span>
                      <select
                        value={step.inputMappings?.[inp.key] ?? ""}
                        onChange={(e) =>
                          updateStep(i, {
                            inputMappings: {
                              ...step.inputMappings,
                              [inp.key]: e.target.value,
                            },
                          })
                        }
                        className="flex-1 rounded-md border border-hairline bg-surface-1 px-2 py-1.5 text-xs text-ink focus:border-primary/40 focus:outline-none"
                      >
                        <option value="">Auto / Default</option>
                        {sources.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Editor / critique loop config */}
            <div className="border-t border-hairline pt-3">
              <label className="flex items-center gap-2 text-xs font-medium text-ink-subtle">
                <input
                  type="checkbox"
                  checked={step.editor?.enabled ?? false}
                  onChange={(e) => {
                    const editor: EditorConfig = step.editor ?? {
                      enabled: false,
                      model: "",
                      systemPrompt:
                        "You are a strict content editor. Check for clarity, accuracy, and engagement.",
                      maxRounds: 3,
                      approvalMode: "auto",
                    };
                    updateStep(i, {
                      editor: { ...editor, enabled: e.target.checked },
                    });
                  }}
                  className="rounded border-hairline"
                />
                Enable Editor (AI critique loop)
              </label>

              {step.editor?.enabled && (
                <div className="mt-2 space-y-2 rounded-lg border border-hairline bg-surface-1 p-3">
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
                      Editor Model
                    </label>
                    <ModelSelector
                      value={step.editor.model}
                      onChange={(model) =>
                        updateStep(i, {
                          editor: { ...step.editor!, model },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
                      Editor Persona
                    </label>
                    <textarea
                      value={step.editor.systemPrompt}
                      onChange={(e) =>
                        updateStep(i, {
                          editor: {
                            ...step.editor!,
                            systemPrompt: e.target.value,
                          },
                        })
                      }
                      placeholder="Describe the editor's role and criteria..."
                      rows={4}
                      className="w-full rounded-md border border-hairline bg-surface-2 px-2 py-1.5 text-xs text-ink placeholder:text-ink-tertiary focus:border-primary/40 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
                        Max Rounds
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={step.editor.maxRounds}
                        onChange={(e) =>
                          updateStep(i, {
                            editor: {
                              ...step.editor!,
                              maxRounds: parseInt(e.target.value),
                            },
                          })
                        }
                        className="w-full"
                      />
                      <div className="flex justify-between text-[10px] text-ink-tertiary">
                        <span>1</span>
                        <span>{step.editor.maxRounds}</span>
                        <span>10</span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
                        Approval
                      </label>
                      <select
                        value={step.editor.approvalMode}
                        onChange={(e) =>
                          updateStep(i, {
                            editor: {
                              ...step.editor!,
                              approvalMode: e.target.value as
                                | "auto"
                                | "manual",
                            },
                          })
                        }
                        className="w-full rounded-md border border-hairline bg-surface-2 px-2 py-1.5 text-xs text-ink focus:border-primary/40 focus:outline-none"
                      >
                        <option value="auto">Auto (editor decides)</option>
                        <option value="manual">
                          Manual (you approve)
                        </option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
