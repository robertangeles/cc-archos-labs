"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";

interface SkillInput {
  key: string;
  label: string;
  type: string;
  isRequired: boolean;
  defaultValue: string | null;
}

interface ChatSkillFormProps {
  skillName: string;
  skillId: string;
  inputs: SkillInput[];
  onExecute: (skillId: string, inputValues: Record<string, string>) => void;
  onCancel: () => void;
  isExecuting?: boolean;
}

export function ChatSkillForm({
  skillName,
  skillId,
  inputs,
  onExecute,
  onCancel,
  isExecuting,
}: ChatSkillFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const input of inputs) {
      init[input.key] = input.defaultValue ?? "";
    }
    return init;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onExecute(skillId, values);
  }

  const hasInputs = inputs.length > 0;

  return (
    <div className="my-3 rounded-xl border border-neutral-700 bg-neutral-800/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium text-neutral-200">
            {skillName}
          </span>
        </div>
        <button
          onClick={onCancel}
          className="p-1 text-neutral-500 hover:text-neutral-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {hasInputs ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          {inputs.map((input) => (
            <div key={input.key}>
              <label className="mb-1 block text-xs text-neutral-400">
                {input.label}
                {input.isRequired && (
                  <span className="ml-1 text-red-400">*</span>
                )}
              </label>
              {input.type === "multiline" ? (
                <textarea
                  value={values[input.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [input.key]: e.target.value }))
                  }
                  required={input.isRequired}
                  rows={3}
                  className="w-full rounded-lg border border-neutral-600 bg-neutral-700/50 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                />
              ) : (
                <input
                  type="text"
                  value={values[input.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [input.key]: e.target.value }))
                  }
                  required={input.isRequired}
                  className="w-full rounded-lg border border-neutral-600 bg-neutral-700/50 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                />
              )}
            </div>
          ))}
          <button
            type="submit"
            disabled={isExecuting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {isExecuting ? "Running..." : "Run Skill"}
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-xs text-neutral-400">No inputs required.</p>
          <button
            onClick={() => onExecute(skillId, {})}
            disabled={isExecuting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {isExecuting ? "Running..." : "Run Now"}
          </button>
        </div>
      )}
    </div>
  );
}
