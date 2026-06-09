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
              {isUser ? "You" : "Metis"}
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
            <div className="max-w-none text-[15px] leading-[1.8] text-neutral-300 [&>p+p]:mt-5 [&>h1]:mt-6 [&>h1]:mb-3 [&>h1]:text-xl [&>h1]:font-semibold [&>h1]:text-neutral-200 [&>h2]:mt-5 [&>h2]:mb-2 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:text-neutral-200 [&>h3]:mt-4 [&>h3]:mb-2 [&>h3]:font-semibold [&>h3]:text-neutral-200 [&>ul]:my-3 [&>ul]:pl-5 [&>ul]:list-disc [&>ol]:my-3 [&>ol]:pl-5 [&>ol]:list-decimal [&_li]:mb-1.5 [&>blockquote]:my-4 [&>blockquote]:border-l-2 [&>blockquote]:border-neutral-700 [&>blockquote]:pl-4 [&>blockquote]:italic [&>blockquote]:text-neutral-400 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-neutral-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:text-neutral-200 [&>pre]:my-4 [&>pre]:rounded-lg [&>pre]:border [&>pre]:border-neutral-800 [&>pre]:bg-neutral-900 [&>pre]:p-4 [&_strong]:text-neutral-100">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
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
