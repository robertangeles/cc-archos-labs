"use client";

import { useRef, useEffect, KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  placeholder = "Type a message...",
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  }

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div className="relative rounded-xl border border-hairline bg-surface-1 transition-colors focus-within:border-primary/50">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="block max-h-[200px] min-h-[96px] w-full resize-none bg-transparent py-4 pr-14 pl-4 text-[15px] leading-relaxed text-neutral-100 placeholder-neutral-500 outline-none"
      />
      <button
        onClick={onSend}
        disabled={!canSend}
        className={`absolute right-2.5 bottom-2.5 flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 ${
          canSend
            ? "bg-primary text-white hover:bg-primary-hover"
            : "bg-neutral-800 text-neutral-600"
        }`}
      >
        <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}
