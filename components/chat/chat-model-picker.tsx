"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useEnabledModels } from "@/components/skills/use-enabled-models";

interface ChatModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
}

function shortName(modelId: string): string {
  const raw = modelId.split("/").pop() ?? modelId;
  return raw
    .replace(/-\d{8}$/, "")
    .replace(/^claude-/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function ChatModelPicker({ value, onChange }: ChatModelPickerProps) {
  const models = useEnabledModels();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-[12px] text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink-muted"
      >
        {shortName(value)}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-80 rounded-lg border border-hairline bg-surface-1 py-1 shadow-xl">
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
            Select model
          </p>
          {(models ?? []).map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
              className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 ${
                m.id === value ? "bg-primary/5" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                {m.id === value && (
                  <Check className="h-3 w-3 shrink-0 text-primary" />
                )}
                <span
                  className={`text-[14px] font-medium ${
                    m.id === value ? "text-primary" : "text-ink"
                  }`}
                >
                  {m.name}
                </span>
                <span className="text-[11px] text-ink-tertiary">{m.provider}</span>
              </div>
              {m.description && (
                <p className={`text-[12px] leading-snug text-ink-subtle ${m.id === value ? "pl-5" : ""}`}>
                  {m.description}
                </p>
              )}
            </button>
          ))}
          {!models && (
            <p className="px-3 py-2 text-[12px] text-ink-tertiary">Loading models...</p>
          )}
        </div>
      )}
    </div>
  );
}
