"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check } from "lucide-react";

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
    <div className={`group py-5 ${isUser ? "" : ""}`}>
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={`text-[12px] font-semibold uppercase tracking-wide ${
                isUser ? "text-ink-subtle" : "text-primary"
              }`}
            >
              {isUser ? "You" : "Archos"}
            </span>
            {isInterrupted && (
              <span className="rounded-full bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                Interrupted
              </span>
            )}
            {isStreaming && (
              <span className="flex items-center gap-1.5 text-[11px] text-neutral-600">
                <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-blue-500" />
                typing
              </span>
            )}
          </div>

          {isUser ? (
            <div className="whitespace-pre-wrap text-[15px] leading-[1.7] text-neutral-200">
              {content}
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none text-neutral-300 prose-headings:text-neutral-200 prose-p:leading-[1.7] prose-a:text-blue-400 prose-code:text-neutral-200 prose-pre:bg-neutral-900 prose-pre:border prose-pre:border-neutral-800">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          )}

          {!isUser && content && !isStreaming && (
            <button
              onClick={handleCopy}
              className="mt-3 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-neutral-600 opacity-0 transition-all hover:bg-neutral-800 hover:text-neutral-400 group-hover:opacity-100"
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
    </div>
  );
}
