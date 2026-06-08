"use client";

import { useRef, useEffect, useState, KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Plus, Search, Globe, Sparkles, X } from "lucide-react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  modelPicker?: ReactNode;
  onToolSelect?: (tool: string) => void;
}

const TOOLS = [
  { id: "research", label: "Research", icon: Search },
  { id: "web-search", label: "Web search", icon: Globe },
  { id: "run-skill", label: "Run a skill", icon: Sparkles },
];

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  placeholder = "Type a message...",
  modelPicker,
  onToolSelect,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  }

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div className="rounded-xl border border-hairline bg-surface-1 transition-colors focus-within:border-primary/50">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="block max-h-[160px] min-h-[56px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] leading-relaxed text-ink placeholder-ink-tertiary outline-none"
      />
      <div className="flex items-center justify-between px-3 pb-2.5">
        {/* Left: tools button */}
        <div ref={toolsRef} className="relative">
          <button
            type="button"
            onClick={() => setToolsOpen(!toolsOpen)}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
              toolsOpen
                ? "bg-primary/10 text-primary"
                : "text-ink-tertiary hover:bg-surface-2 hover:text-ink-subtle"
            }`}
          >
            {toolsOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>

          {toolsOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-48 rounded-lg border border-hairline bg-surface-1 py-1 shadow-xl">
              <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
                Tools
              </p>
              {TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => {
                    setToolsOpen(false);
                    onToolSelect?.(tool.id);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-[14px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <tool.icon className="h-4 w-4 text-ink-subtle" />
                  {tool.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: model picker + send */}
        <div className="flex items-center gap-2">
          {modelPicker}
          {canSend && (
            <button
              onClick={onSend}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-white transition-colors hover:bg-primary-hover"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
