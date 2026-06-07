"use client";

import { useState, useRef, useCallback } from "react";
import { Plus, ArrowUp, ArrowDown, X } from "lucide-react";
import type { WorkflowFieldDef } from "@/lib/workflows/types";

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const FIELD_TYPES: Array<{ value: WorkflowFieldDef["type"]; label: string }> = [
  { value: "text", label: "Text" },
  { value: "multiline", label: "Multiline" },
  { value: "dropdown", label: "Dropdown" },
  { value: "image", label: "Image" },
  { value: "document", label: "Document" },
];

interface FieldBuilderProps {
  fields: WorkflowFieldDef[];
  onFieldsChange: (fields: WorkflowFieldDef[]) => void;
}

export function FieldBuilder({ fields, onFieldsChange }: FieldBuilderProps) {
  const [local, setLocal] = useState<WorkflowFieldDef[]>(fields);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = useCallback(
    (updated: WorkflowFieldDef[]) => {
      setLocal(updated);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onFieldsChange(updated), 400);
    },
    [onFieldsChange],
  );

  const addField = () => {
    save([
      ...local,
      {
        id: uid(),
        type: "text",
        label: "",
        placeholder: "",
        required: false,
      },
    ]);
  };

  const updateField = (i: number, updates: Partial<WorkflowFieldDef>) => {
    save(local.map((f, idx) => (idx === i ? { ...f, ...updates } : f)));
  };

  const removeField = (i: number) => {
    save(local.filter((_, idx) => idx !== i));
  };

  const moveField = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= local.length) return;
    const a = [...local];
    [a[i], a[t]] = [a[t], a[i]];
    save(a);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">
          {local.length} field{local.length !== 1 ? "s" : ""}
        </p>
        <button
          type="button"
          onClick={addField}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-3 w-3" />
          Add Field
        </button>
      </div>

      {local.length === 0 && (
        <p className="py-4 text-center text-xs text-ink-tertiary">
          No input fields yet. Add one to get started.
        </p>
      )}

      {local.map((field, i) => (
        <div
          key={field.id}
          className="space-y-2 rounded-lg border border-hairline bg-surface-2/50 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-tertiary">
              Field {i + 1}
            </span>
            <div className="flex gap-0.5">
              <button
                type="button"
                onClick={() => moveField(i, -1)}
                disabled={i === 0}
                className="rounded p-1 text-ink-tertiary hover:bg-surface-2 disabled:opacity-30"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => moveField(i, 1)}
                disabled={i === local.length - 1}
                className="rounded p-1 text-ink-tertiary hover:bg-surface-2 disabled:opacity-30"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => removeField(i)}
                className="rounded p-1 text-red-500 hover:bg-red-500/10"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
                Type
              </label>
              <select
                value={field.type}
                onChange={(e) =>
                  updateField(i, {
                    type: e.target.value as WorkflowFieldDef["type"],
                  })
                }
                className="w-full rounded-md border border-hairline bg-surface-1 px-2 py-1.5 text-xs text-ink focus:border-primary/40 focus:outline-none"
              >
                {FIELD_TYPES.map((ft) => (
                  <option key={ft.value} value={ft.value}>
                    {ft.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
                Label
              </label>
              <input
                type="text"
                value={field.label}
                onChange={(e) => updateField(i, { label: e.target.value })}
                placeholder="Field label"
                className="w-full rounded-md border border-hairline bg-surface-1 px-2 py-1.5 text-xs text-ink placeholder:text-ink-tertiary focus:border-primary/40 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
              Placeholder
            </label>
            <input
              type="text"
              value={field.placeholder ?? ""}
              onChange={(e) => updateField(i, { placeholder: e.target.value })}
              placeholder="Placeholder text"
              className="w-full rounded-md border border-hairline bg-surface-1 px-2 py-1.5 text-xs text-ink placeholder:text-ink-tertiary focus:border-primary/40 focus:outline-none"
            />
          </div>

          {field.type === "dropdown" && (
            <OptionsInput
              options={field.options ?? []}
              onChange={(options) => updateField(i, { options })}
            />
          )}

          <label className="flex items-center gap-2 text-xs text-ink-subtle">
            <input
              type="checkbox"
              checked={field.required ?? false}
              onChange={(e) => updateField(i, { required: e.target.checked })}
              className="rounded border-hairline"
            />
            Required
          </label>
        </div>
      ))}
    </div>
  );
}

function OptionsInput({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const [raw, setRaw] = useState(options.join("; "));

  const handleBlur = () => {
    onChange(
      raw
        .split(";")
        .map((o) => o.trim())
        .filter(Boolean),
    );
  };

  return (
    <div>
      <label className="mb-0.5 block text-[11px] font-medium text-ink-subtle">
        Options (semicolon-separated)
      </label>
      <input
        type="text"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={handleBlur}
        placeholder="Option 1; Option 2; Option 3"
        className="w-full rounded-md border border-hairline bg-surface-1 px-2 py-1.5 text-xs text-ink placeholder:text-ink-tertiary focus:border-primary/40 focus:outline-none"
      />
    </div>
  );
}
