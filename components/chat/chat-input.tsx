"use client";

import {
  useRef,
  useEffect,
  useState,
  type KeyboardEvent,
  type DragEvent,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import { ArrowUp, Plus, Search, Globe, Image as ImageIcon, X, Paperclip, Check, FileText, Loader2, AlertCircle } from "lucide-react";
import { CHAT_MODE_CONFIG, type ChatMode } from "@/lib/chat/modes";

// One attached document as the input renders it. `id` is a temporary client id
// while uploading, then the real document id once ready. charCount + snippet
// (present once ready) power the extraction preview.
export interface AttachedFile {
  id: string;
  fileName: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  charCount?: number;
  snippet?: string;
}

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k chars` : `${n} chars`;
}

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
  attachments?: AttachedFile[];
  onAttachFiles?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
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
  attachments = [],
  onAttachFiles,
  onRemoveAttachment,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  // E1: drag-and-drop + paste-to-attach, routed to the same upload path.
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) onAttachFiles?.(e.dataTransfer.files);
  }
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget === e.target) setIsDragging(false);
  }
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = e.clipboardData?.files;
    if (files?.length && Array.from(files).some((f) => f.size > 0)) {
      e.preventDefault();
      onAttachFiles?.(files);
    }
  }

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
    <div
      className={`relative rounded-xl border bg-surface-1 transition-colors ${
        isDragging
          ? "border-primary/70"
          : "border-hairline focus-within:border-primary/50"
      }`}
      onDrop={onAttachFiles ? handleDrop : undefined}
      onDragOver={onAttachFiles ? handleDragOver : undefined}
      onDragLeave={onAttachFiles ? handleDragLeave : undefined}
    >
      {isDragging && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface-1/90"
          aria-hidden="true"
        >
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink-muted">
            <Paperclip className="h-4 w-4" />
            Drop to attach
          </div>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={onAttachFiles ? handlePaste : undefined}
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
      {attachments.length > 0 && (
        <ul
          className="flex flex-wrap gap-1.5 px-3 pb-1.5"
          aria-label="Attached documents"
          aria-live="polite"
        >
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-[12px] text-ink-muted"
            >
              {att.status === "uploading" ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-ink-subtle" />
              ) : att.status === "error" ? (
                <AlertCircle className="h-3 w-3 shrink-0 text-ink-subtle" />
              ) : (
                <FileText className="h-3 w-3 shrink-0 text-ink-subtle" />
              )}
              {att.status === "ready" ? (
                // E3: open the document in a new tab via the authz'd proxy.
                // E2: the extracted-text snippet + char count on hover.
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      `/api/chat/documents/${att.id}/file`,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  title={
                    att.snippet
                      ? `Preview: ${att.snippet}${att.snippet.length >= 300 ? "…" : ""}`
                      : "Open document"
                  }
                  className="flex max-w-[220px] items-center gap-1 truncate rounded text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                >
                  <span className="truncate">{att.fileName}</span>
                  {att.charCount != null && (
                    <span className="shrink-0 text-ink-subtle">
                      · {formatCount(att.charCount)}
                    </span>
                  )}
                </button>
              ) : (
                <span
                  className="max-w-[220px] truncate"
                  title={att.status === "error" ? att.error : att.fileName}
                >
                  {att.status === "error" ? (att.error ?? att.fileName) : att.fileName}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemoveAttachment?.(att.id)}
                className="ml-0.5 rounded-full p-0.5 text-ink-tertiary transition-colors hover:bg-white/10 hover:text-ink-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                aria-label={`Remove ${att.fileName}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between px-3 pb-2.5">
        {/* Left: attach + tools */}
        <div className="flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.docx"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAttachFiles?.(e.target.files);
            }
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
        <button
          type="button"
          title="Attach files"
          aria-label="Attach files"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
          onClick={() => fileInputRef.current?.click()}
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
