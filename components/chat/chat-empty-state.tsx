"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Shield, FileText, AlertTriangle, PenLine, MessageSquare, type LucideIcon } from "lucide-react";

interface ChatEmptyStateProps {
  displayName: string | null;
  onSuggestion: (text: string) => void;
}

interface Greeting {
  text: string;
  language: string;
  region: string;
}

const GREETINGS: Greeting[] = [
  { text: "Hello", language: "English", region: "Australia" },
  { text: "Hallo", language: "German", region: "Germany" },
  { text: "Bonjour", language: "French", region: "France" },
  { text: "Kamusta", language: "Filipino", region: "Philippines" },
  { text: "Kia ora", language: "Maori", region: "New Zealand" },
  { text: "Hej", language: "Swedish", region: "Sweden" },
  { text: "Ciao", language: "Italian", region: "Italy" },
  { text: "Merhaba", language: "Turkish", region: "Turkey" },
];

const SUGGESTIONS: Array<{ text: string; Icon: LucideIcon; color: string }> = [
  { text: "Review my data governance framework", Icon: Shield, color: "text-sky-400" },
  { text: "Help me write an AI strategy brief", Icon: FileText, color: "text-amber-400" },
  { text: "Explain the risks of ungoverned data pipelines", Icon: AlertTriangle, color: "text-rose-400" },
  { text: "Draft an executive summary for my board", Icon: PenLine, color: "text-emerald-400" },
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  dur: number;
}

function seeded(i: number): number {
  const x = Math.sin(i * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const PARTICLES: Particle[] = Array.from({ length: 30 }, (_, i) => ({
  x: seeded(i * 7) * 100,
  y: seeded(i * 13 + 1) * 100,
  vx: (seeded(i * 17 + 2) - 0.5) * 0.15,
  vy: (seeded(i * 23 + 3) - 0.5) * 0.15,
  size: seeded(i * 29 + 4) * 2 + 1,
  opacity: seeded(i * 31 + 5) * 0.3 + 0.1,
  dur: 20 + seeded(i * 37 + 6) * 15,
}));

export function ChatEmptyState({
  displayName,
  onSuggestion,
}: ChatEmptyStateProps) {
  const name = displayName?.split(" ")[0] ?? "";
  const [greetingIdx, setGreetingIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setGreetingIdx((i) => (i + 1) % GREETINGS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const greeting = GREETINGS[greetingIdx];

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 pb-0 pt-[5vh]">
      {/* Animated particles */}
      <div className="pointer-events-none absolute inset-0">
        {PARTICLES.map((p, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full bg-primary"
            style={{ width: p.size, height: p.size }}
            initial={{ x: `${p.x}vw`, y: `${p.y}%`, opacity: 0 }}
            animate={{
              x: [`${p.x}vw`, `${p.x + p.vx * 100}vw`],
              y: [`${p.y}%`, `${p.y + p.vy * 100}%`],
              opacity: [0, p.opacity, p.opacity, 0],
            }}
            transition={{
              duration: p.dur,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}
      </div>

      {/* Hero icon */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20"
      >
        <MessageSquare className="h-8 w-8 text-primary" />
      </motion.div>

      {/* Greeting with language rotation */}
      <motion.div
        key={greetingIdx}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl text-center"
      >
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {greeting.text}
          {name ? `, ${name}` : ""}
          <span className="text-primary">.</span>
        </h1>
        <p className="mt-1.5 text-[13px] text-neutral-500">
          {greeting.language} — {greeting.region}
        </p>
        <p className="mt-2 text-base text-neutral-400">
          Drop an idea. Walk away with insight.
        </p>
      </motion.div>

      {/* Suggestion cards with colored icons */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
        className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {SUGGESTIONS.map(({ text, Icon, color }, i) => (
          <motion.button
            key={text}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 + i * 0.06 }}
            onClick={() => onSuggestion(text)}
            className="group flex items-start gap-3 rounded-lg border border-hairline bg-surface-1 px-4 py-3.5 text-left transition-all duration-200 hover:border-hairline-strong hover:bg-surface-2"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
            <span className="text-sm leading-relaxed text-neutral-400 transition-colors group-hover:text-neutral-200">
              {text}
            </span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
