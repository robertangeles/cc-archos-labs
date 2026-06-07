"use client";

import { OPENROUTER_MODELS } from "@/lib/skills/types";

interface Props {
  value: string;
  onChange: (modelId: string) => void;
}

export function ModelSelector({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
    >
      <option value="">Select a model</option>
      {OPENROUTER_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} ({m.provider})
        </option>
      ))}
    </select>
  );
}
