"use client";

import { motion } from "framer-motion";

interface ChatEmptyStateProps {
  displayName: string | null;
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  { text: "Review my data governance framework", icon: "shield" },
  { text: "Help me write an AI strategy brief", icon: "doc" },
  { text: "Explain the risks of ungoverned data pipelines", icon: "alert" },
  { text: "Draft an executive summary for my board", icon: "pen" },
] as const;

const ICONS: Record<string, string> = {
  shield: "⚔",
  doc: "✍",
  alert: "⚠",
  pen: "✒",
};

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
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-2xl text-center"
      >
        <h1 className="text-3xl font-light tracking-tight text-white sm:text-4xl">
          {greeting}
          {name ? `, ${name}` : ""}
          <span className="text-neutral-600">.</span>
        </h1>
        <p className="mt-3 text-base text-neutral-500">
          How can I help today?
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
        className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2"
      >
        {SUGGESTIONS.map(({ text, icon }, i) => (
          <motion.button
            key={text}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 + i * 0.06 }}
            onClick={() => onSuggestion(text)}
            className="group flex items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3.5 text-left transition-all duration-200 hover:border-neutral-600 hover:bg-neutral-800/80"
          >
            <span className="mt-0.5 text-sm text-neutral-600 transition-colors group-hover:text-neutral-400">
              {ICONS[icon]}
            </span>
            <span className="text-sm leading-relaxed text-neutral-400 transition-colors group-hover:text-neutral-200">
              {text}
            </span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
