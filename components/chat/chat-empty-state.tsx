"use client";

import { MessageSquare } from "lucide-react";

interface ChatEmptyStateProps {
  displayName: string | null;
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  "Review my data governance framework",
  "Help me write an AI strategy brief",
  "Explain the risks of ungoverned data pipelines",
  "Draft an executive summary for my board",
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function ChatEmptyState({
  displayName,
  onSuggestion,
}: ChatEmptyStateProps) {
  const greeting = getGreeting();
  const name = displayName?.split(" ")[0] ?? "";

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800">
        <MessageSquare className="h-7 w-7 text-neutral-400" />
      </div>

      <h1 className="mb-1 text-2xl font-semibold text-white">
        {greeting}{name ? `, ${name}` : ""}.
      </h1>
      <p className="mb-8 text-sm text-neutral-400">
        How can I help today?
      </p>

      <div className="grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            onClick={() => onSuggestion(text)}
            className="rounded-xl border border-neutral-700 bg-neutral-800/50 px-4 py-3 text-left text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
