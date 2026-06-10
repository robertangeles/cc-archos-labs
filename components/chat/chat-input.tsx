"use client";

import { useRef, useEffect, useState, KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Plus, Search, Globe, Image as ImageIcon, X, Paperclip, Check } from "lucide-react";
import { CHAT_MODE_CONFIG, type ChatMode } from "@/lib/chat/modes";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  modelPicker?: ReactNode;
  onToolSelect?: (tool: string) => void;
  activeMode?: ChatMode;
  onClearMode?: () => void;
}

const TOOLS = [
  { id: "research", label: "Research", icon: Search },
  { id: "web-search", label: "Web search", icon: Globe },
  { id: "generate-image", label: "Generate image", icon: ImageIcon },
];

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  placeholder = "Type a message...",
  modelPicker,
  onToolSelect,
  activeMode,
  onClearMode,
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
      {activeMode && (
        <div className="flex items-center px-3 pb-1">
          <div
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${CHAT_MODE_CONFIG[activeMode].bgColor} ${CHAT_MODE_CONFIG[activeMode].borderColor}`}
          >
            {activeMode === "research" ? (
              <Search className={`h-3 w-3 ${CHAT_MODE_CONFIG[activeMode].color}`} />
            ) : activeMode === "generate-image" ? (
              <ImageIcon className={`h-3 w-3 ${CHAT_MODE_CONFIG[activeMode].color}`} />
            ) : (
              <Globe className={`h-3 w-3 ${CHAT_MODE_CONFIG[activeMode].color}`} />
            )}
            <span
              className={`text-[11px] font-medium ${CHAT_MODE_CONFIG[activeMode].color}`}
            >
              {CHAT_MODE_CONFIG[activeMode].label}
            </span>
            <button
              type="button"
              onClick={onClearMode}
              className={`ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10 ${CHAT_MODE_CONFIG[activeMode].color}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between px-3 pb-2.5">
        {/* Left: attach + tools */}
        <div className="flex items-center gap-1">
        <button
          type="button"
          title="Attach files (coming soon)"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink-subtle"
          onClick={() => {}}
        >
          <Paperclip className="h-4 w-4" />
        </button>
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
              {TOOLS.map((tool) => {
                const isActive = activeMode === tool.id;
                return (
                  <button
                    key={tool.id}
                    onClick={() => {
                      setToolsOpen(false);
                      onToolSelect?.(tool.id);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-[14px] transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    <tool.icon
                      className={`h-4 w-4 ${isActive ? "text-primary" : "text-ink-subtle"}`}
                    />
                    {tool.label}
                    {isActive && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
