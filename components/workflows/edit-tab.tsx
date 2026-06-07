"use client";

import { useState } from "react";
import { ChevronDown, FormInput, GitBranch, Settings } from "lucide-react";
import { FieldBuilder } from "./field-builder";
import { StepDesigner } from "./step-designer";
import { WorkflowSettings } from "./workflow-settings";
import type { WorkflowFieldDef, WorkflowStepDef } from "@/lib/workflows/types";

interface EditTabProps {
  workflow: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  fields: WorkflowFieldDef[];
  steps: WorkflowStepDef[];
  onFieldsChange: (fields: WorkflowFieldDef[]) => void;
  onStepsChange: (steps: WorkflowStepDef[]) => void;
  onUpdate: (updates: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}

function CollapsibleSection({
  title,
  icon,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-hairline bg-surface-1 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-surface-2/50"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <p className="text-[11px] text-ink-tertiary">{description}</p>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-ink-tertiary transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div className="border-t border-hairline px-5 py-4">{children}</div>
      )}
    </div>
  );
}

export function EditTab({
  workflow,
  fields,
  steps,
  onFieldsChange,
  onStepsChange,
  onUpdate,
  onDelete,
}: EditTabProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <CollapsibleSection
        title="Inputs"
        icon={<FormInput className="h-4 w-4" />}
        description="Define the input fields users fill before running"
        defaultOpen={true}
      >
        <FieldBuilder fields={fields} onFieldsChange={onFieldsChange} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Steps"
        icon={<GitBranch className="h-4 w-4" />}
        description="Add skills and configure the orchestration pipeline"
        defaultOpen={true}
      >
        <StepDesigner
          steps={steps}
          fields={fields}
          onStepsChange={onStepsChange}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Settings"
        icon={<Settings className="h-4 w-4" />}
        description="Name, description, status, and danger zone"
        defaultOpen={false}
      >
        <WorkflowSettings
          workflow={workflow}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      </CollapsibleSection>
    </div>
  );
}
