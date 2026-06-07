"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, FormInput, GitBranch, Settings, Play } from "lucide-react";
import { FieldBuilder } from "./field-builder";
import { StepDesigner } from "./step-designer";
import { WorkflowSettings } from "./workflow-settings";
import { RunTab } from "./run-tab";
import type { WorkflowFieldDef, WorkflowStepDef } from "@/lib/workflows/types";

interface WorkflowData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  style: unknown;
  createdAt: string;
  updatedAt: string;
  fields: Array<{
    fieldId: string;
    type: string;
    label: string;
    placeholder: string | null;
    isRequired: boolean;
    options: unknown;
    sortOrder: number;
  }>;
  steps: Array<{
    stepId: string;
    skillId: string | null;
    skillVersion: number | null;
    model: string;
    provider: string | null;
    prompt: string;
    capabilities: unknown;
    inputMappings: unknown;
    overrides: unknown;
    editorConfig: unknown;
    sortOrder: number;
  }>;
}

const TABS = [
  { key: "inputs", label: "Inputs", icon: FormInput },
  { key: "steps", label: "Steps", icon: GitBranch },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "run", label: "Run", icon: Play },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function WorkflowBuilder({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("steps");
  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/workflows/${workflowId}`);
        if (cancelled) return;
        if (!res.ok) {
          router.push("/account/workflows");
          return;
        }
        const data = await res.json();
        if (!cancelled) setWorkflow(data.workflow);
      } catch {
        if (!cancelled) router.push("/account/workflows");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [workflowId, router]);

  const updateWorkflow = async (updates: Record<string, unknown>) => {
    setSaveError(null);
    const res = await fetch(`/api/workflows/${workflowId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const full = await fetch(`/api/workflows/${workflowId}`);
      if (full.ok) {
        const data = await full.json();
        setWorkflow(data.workflow);
      }
    } else {
      const data = await res.json().catch(() => ({ error: "Save failed" }));
      setSaveError(data.error ?? "Save failed");
    }
  };

  const handleRename = async () => {
    if (editName.trim() && editName !== workflow?.name) {
      await updateWorkflow({ name: editName.trim() });
    }
    setIsRenaming(false);
  };

  const handleFieldsChange = (fields: WorkflowFieldDef[]) => {
    updateWorkflow({ config: { fields } });
  };

  const handleStepsChange = (steps: WorkflowStepDef[]) => {
    updateWorkflow({ config: { steps } });
  };

  if (loading || !workflow) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const fields: WorkflowFieldDef[] = workflow.fields.map((f) => ({
    id: f.fieldId,
    type: f.type as WorkflowFieldDef["type"],
    label: f.label,
    placeholder: f.placeholder ?? undefined,
    required: f.isRequired,
    options: (f.options as string[]) ?? undefined,
  }));

  const steps: WorkflowStepDef[] = workflow.steps.map((s) => ({
    id: s.stepId,
    skillId: s.skillId ?? undefined,
    skillVersion: s.skillVersion ?? undefined,
    inputMappings: (s.inputMappings as Record<string, string>) ?? undefined,
    overrides: s.overrides as WorkflowStepDef["overrides"],
    editor: s.editorConfig as WorkflowStepDef["editor"],
    provider: s.provider ?? "",
    model: s.model,
    prompt: s.prompt,
    capabilities: Array.isArray(s.capabilities) ? (s.capabilities as string[]) : [],
    order: s.sortOrder,
  }));

  return (
    <div>
      {/* Save error banner */}
      {saveError && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          Save failed: {saveError}
        </div>
      )}

      {/* Header: back + name + status */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Link
            href="/account/workflows"
            className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface-1 hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          {isRenaming ? (
            <input
              className="rounded border border-hairline bg-surface-1 px-2 py-0.5 text-base font-semibold text-ink focus:border-primary/40 focus:outline-none"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditName(workflow.name);
                setIsRenaming(true);
              }}
              className="group flex items-center gap-1.5 text-base font-semibold text-ink"
            >
              {workflow.name}
              <Pencil className="h-3 w-3 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}

          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              workflow.status === "published"
                ? "bg-green-500/10 text-green-500"
                : workflow.status === "archived"
                  ? "bg-ink-subtle/10 text-ink-subtle"
                  : "bg-amber-500/10 text-amber-500"
            }`}
          >
            {workflow.status}
          </span>

          <span className="text-[11px] text-ink-tertiary">
            {fields.length} fields, {steps.length} steps
          </span>
        </div>
      </div>

      {/* Horizontal tabs */}
      <div className="flex gap-0.5 border-b border-hairline mb-4">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-primary text-ink"
                  : "border-transparent text-ink-subtle hover:text-ink"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content: full width */}
      <div>
        {activeTab === "inputs" && (
          <FieldBuilder fields={fields} onFieldsChange={handleFieldsChange} />
        )}
        {activeTab === "steps" && (
          <StepDesigner
            steps={steps}
            fields={fields}
            onStepsChange={handleStepsChange}
          />
        )}
        {activeTab === "settings" && (
          <WorkflowSettings
            workflow={workflow}
            onUpdate={updateWorkflow}
            onDelete={async () => {
              await fetch(`/api/workflows/${workflowId}`, {
                method: "DELETE",
              });
              router.push("/account/workflows");
            }}
          />
        )}
        {activeTab === "run" && (
          <RunTab
            workflowId={workflowId}
            fields={fields}
            stepCount={steps.length}
          />
        )}
      </div>
    </div>
  );
}
