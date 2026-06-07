"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModelSelector } from "./model-selector";
import {
  SKILL_CATEGORIES,
  type SkillCategory,
  type SkillInputDef,
  type SkillOutputDef,
} from "@/lib/skills/types";
import {
  RefreshCw,
  Sparkles,
  Search,
  Zap,
  Gem,
  ClipboardList,
  Plus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Check,
  type LucideIcon,
} from "lucide-react";

const STEP_LABELS = ["Basics", "Inputs", "Prompt", "Model", "Review"];

const CATEGORY_META: Record<
  SkillCategory,
  { icon: LucideIcon; label: string }
> = {
  repurpose: { icon: RefreshCw, label: "Repurpose" },
  generate: { icon: Sparkles, label: "Generate" },
  research: { icon: Search, label: "Research" },
  transform: { icon: Zap, label: "Transform" },
  extract: { icon: Gem, label: "Extract" },
  plan: { icon: ClipboardList, label: "Plan" },
};

function emptyInput(): SkillInputDef {
  return { key: "", type: "text", label: "", required: false };
}

function emptyOutput(): SkillOutputDef {
  return { key: "result", type: "markdown", label: "Result" };
}

export function SkillCreator() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<SkillCategory>("generate");

  const [inputs, setInputs] = useState<SkillInputDef[]>([emptyInput()]);

  const [promptTemplate, setPromptTemplate] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  const [defaultModel, setDefaultModel] = useState(
    "anthropic/claude-sonnet-4-20250514",
  );
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4000);

  const [outputs] = useState<SkillOutputDef[]>([emptyOutput()]);

  function canProceed(): boolean {
    if (step === 0) return name.trim().length > 0 && description.trim().length > 0;
    if (step === 1)
      return inputs.every(
        (i) => i.key.trim().length > 0 && i.label.trim().length > 0,
      );
    if (step === 2) return promptTemplate.trim().length > 0;
    if (step === 3) return defaultModel.length > 0;
    return true;
  }

  function addInput() {
    setInputs([...inputs, emptyInput()]);
  }

  function removeInput(idx: number) {
    setInputs(inputs.filter((_, i) => i !== idx));
  }

  function updateInput(idx: number, field: string, value: unknown) {
    setInputs(
      inputs.map((inp, i) =>
        i === idx ? { ...inp, [field]: value } : inp,
      ),
    );
  }

  function insertVariable(key: string) {
    setPromptTemplate((p) => p + `{{${key}}}`);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category,
          promptTemplate,
          systemPrompt: systemPrompt || undefined,
          defaultModel,
          temperature,
          maxTokens,
          inputs: inputs.filter((i) => i.key.trim()),
          outputs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create skill.");
        return;
      }
      router.push(`/account/skills/${data.skill.id}`);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[640px]">
      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-2">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-primary/20 text-primary cursor-pointer"
                    : "bg-surface-2 text-ink-tertiary"
              }`}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </button>
            <span
              className={`text-xs ${i === step ? "font-medium text-ink" : "text-ink-tertiary"}`}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <div className="mx-1 h-px w-4 bg-hairline" />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Basics */}
      {step === 0 && (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Data Quality Report Generator"
              className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does this skill do?"
              className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
              Category
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {SKILL_CATEGORIES.map((cat) => {
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                const isSelected = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-hairline bg-surface-1 text-ink-subtle hover:border-hairline-strong"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Inputs */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-ink-subtle">
            Define the input variables for your skill. These become{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">
              {"{{variable}}"}
            </code>{" "}
            placeholders in your prompt template.
          </p>
          {inputs.map((inp, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-hairline bg-surface-1 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium uppercase text-ink-tertiary">
                        Key
                      </label>
                      <input
                        type="text"
                        value={inp.key}
                        onChange={(e) =>
                          updateInput(
                            idx,
                            "key",
                            e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9_]/g, ""),
                          )
                        }
                        placeholder="e.g. content"
                        className="mt-1 block w-full rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium uppercase text-ink-tertiary">
                        Label
                      </label>
                      <input
                        type="text"
                        value={inp.label}
                        onChange={(e) =>
                          updateInput(idx, "label", e.target.value)
                        }
                        placeholder="e.g. Input Content"
                        className="mt-1 block w-full rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <select
                      value={inp.type}
                      onChange={(e) =>
                        updateInput(idx, "type", e.target.value)
                      }
                      className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
                    >
                      <option value="text">Text</option>
                      <option value="multiline">Multiline</option>
                      <option value="select">Select</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-ink-subtle">
                      <input
                        type="checkbox"
                        checked={inp.required}
                        onChange={(e) =>
                          updateInput(idx, "required", e.target.checked)
                        }
                        className="rounded border-hairline"
                      />
                      Required
                    </label>
                  </div>
                </div>
                {inputs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeInput(idx)}
                    className="mt-1 text-ink-tertiary hover:text-semantic-error"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addInput}
            className="flex items-center gap-1.5 text-sm text-primary hover:text-primary-hover"
          >
            <Plus className="h-4 w-4" />
            Add Input
          </button>
        </div>
      )}

      {/* Step 2: Prompt */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
                Prompt Template
              </label>
              {inputs.filter((i) => i.key.trim()).length > 0 && (
                <div className="flex gap-1">
                  {inputs
                    .filter((i) => i.key.trim())
                    .map((i) => (
                      <button
                        key={i.key}
                        type="button"
                        onClick={() => insertVariable(i.key)}
                        className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
                      >
                        {`{{${i.key}}}`}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <textarea
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              rows={10}
              placeholder="Write your prompt template here. Use {{variable_name}} to insert input values."
              className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
              System Prompt (optional)
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="Define the AI's role and personality for this skill."
              className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      )}

      {/* Step 3: Model */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
              Default Model
            </label>
            <div className="mt-1">
              <ModelSelector value={defaultModel} onChange={setDefaultModel} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
              Temperature: {temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
            <div className="flex justify-between text-[11px] text-ink-tertiary">
              <span>Precise (0)</span>
              <span>Creative (2)</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-ink-subtle">
              Max Tokens
            </label>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) =>
                setMaxTokens(
                  Math.max(1, Math.min(32000, Number(e.target.value) || 4000)),
                )
              }
              className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-hairline bg-surface-1 p-5">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[11px] uppercase text-ink-tertiary">
                  Name
                </dt>
                <dd className="mt-0.5 font-medium text-ink">{name}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-ink-tertiary">
                  Category
                </dt>
                <dd className="mt-0.5 text-ink">{category}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-ink-tertiary">
                  Description
                </dt>
                <dd className="mt-0.5 text-ink">{description}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-ink-tertiary">
                  Inputs
                </dt>
                <dd className="mt-0.5 text-ink">
                  {inputs
                    .filter((i) => i.key.trim())
                    .map((i) => `${i.label} (${i.key})`)
                    .join(", ") || "None"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-ink-tertiary">
                  Model
                </dt>
                <dd className="mt-0.5 text-ink">{defaultModel}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-ink-tertiary">
                  Temperature / Max Tokens
                </dt>
                <dd className="mt-0.5 text-ink">
                  {temperature} / {maxTokens}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-ink-tertiary">
                  Prompt Preview
                </dt>
                <dd className="mt-1 max-h-32 overflow-auto rounded bg-canvas p-3 font-mono text-xs text-ink-subtle">
                  {promptTemplate.slice(0, 500)}
                  {promptTemplate.length > 500 && "..."}
                </dd>
              </div>
            </dl>
          </div>
          {error && (
            <p className="text-sm text-semantic-error">{error}</p>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => (step === 0 ? router.push("/account") : setStep(step - 1))}
          className="flex items-center gap-1.5 text-sm text-ink-subtle hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          {step === 0 ? "Cancel" : "Back"}
        </button>

        {step < 4 ? (
          <button
            type="button"
            disabled={!canProceed()}
            onClick={() => setStep(step + 1)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Skill"}
            <Check className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
