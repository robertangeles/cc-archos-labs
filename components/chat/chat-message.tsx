"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User, Copy, Check } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  model?: string | null;
  isStreaming?: boolean;
  isInterrupted?: boolean;
}

export function ChatMessage({
  role,
  content,
  model,
  isStreaming,
  isInterrupted,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = role === "user";

  async function handleCopy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`group flex gap-3 py-4 ${isUser ? "" : "bg-neutral-900/30"}`}>
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-neutral-700 text-neutral-300"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-500">
            {isUser ? "You" : "Assistant"}
          </span>
          {model && !isUser && (
            <span className="text-xs text-neutral-600">{model}</span>
          )}
          {isStreaming && (
            <span className="text-xs text-amber-500">Generating...</span>
          )}
          {isInterrupted && (
            <span className="text-xs text-red-400">Interrupted</span>
          )}
        </div>

        {isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
            {content}
          </div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none text-neutral-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}

        {!isUser && content && !isStreaming && (
          <button
            onClick={handleCopy}
            className="mt-2 flex items-center gap-1 text-xs text-neutral-500 opacity-0 transition-opacity hover:text-neutral-300 group-hover:opacity-100"
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
