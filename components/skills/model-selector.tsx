"use client";

import { useState, useRef, useEffect } from "react";
import { OPENROUTER_MODELS } from "@/lib/skills/types";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

interface Props {
  value: string;
  onChange: (modelId: string) => void;
  models?: ModelOption[];
}

function formatModelId(id: string): { name: string; provider: string } {
  const parts = id.split("/");
  const provider = parts[0] ?? "Unknown";
  const raw = parts.slice(1).join("/") || id;
  const name = raw
    .replace(/-\d{8}$/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    name,
    provider: provider.charAt(0).toUpperCase() + provider.slice(1),
  };
}

export function ModelSelector({ value, onChange, models }: Props) {
  const list: ModelOption[] = models ?? OPENROUTER_MODELS.map((m) => ({ ...m }));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (models && models.length === 0) {
    return (
      <p className="rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink-subtle">
        No models available yet. Ask your admin to enable models in Settings.
      </p>
    );
  }

  const selected = list.find((m) => m.id === value);
  const selectedDisplay = selected
    ? selected
    : value
      ? { ...formatModelId(value), id: value, description: "This model is no longer in the enabled list" }
      : null;

  const filtered = search
    ? list.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.provider.toLowerCase().includes(search.toLowerCase()) ||
          m.id.toLowerCase().includes(search.toLowerCase()),
      )
    : list;

  function handleSelect(id: string) {
    onChange(id);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex w-full items-center justify-between rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-left text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {selectedDisplay ? (
          <div className="min-w-0 flex-1">
            <span className="text-ink">{selectedDisplay.name}</span>
            <span className="ml-1.5 text-ink-tertiary">({selectedDisplay.provider})</span>
            {!selected && value && (
              <span className="ml-1.5 text-[11px] text-ink-tertiary">(not enabled)</span>
            )}
          </div>
        ) : (
          <span className="text-ink-subtle/60">Select a model</span>
        )}
        <svg className="ml-2 h-4 w-4 shrink-0 text-ink-tertiary" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-hairline bg-surface-2 shadow-xl">
          <div className="border-b border-hairline/50 p-2">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full rounded border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink placeholder:text-ink-subtle/60 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-subtle">No models match</p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.id)}
                  className={`flex w-full flex-col gap-0.5 border-b border-hairline/20 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-3 ${
                    m.id === value ? "bg-surface-3/50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{m.name}</span>
                    <span className="text-[11px] text-ink-tertiary">{m.provider}</span>
                  </div>
                  {m.description && (
                    <p className="text-[12px] leading-tight text-ink-subtle">{m.description}</p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
