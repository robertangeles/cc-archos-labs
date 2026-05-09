"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Staged progress UI replacing the spec's original "8-second silent
// wait" (per the CEO-review reduction). Cycles through three honest
// status messages while the OpenRouter Claude call runs server-side
// and the report rows persist. Typical end-to-end is 5–15s.

const STAGES = [
  "Reviewing your answers",
  "Drafting your report",
  "Almost ready",
] as const;

const STAGE_INTERVAL_MS = 3500;

export function SubmittingScreen() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStage((s) => Math.min(s + 1, STAGES.length - 1));
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="flex flex-1 items-center justify-center bg-canvas px-6 py-32 md:px-12">
      <div className="flex flex-col items-center gap-y-6 text-center">
        <div className="flex items-center gap-x-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2 w-2 rounded-full bg-accent"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.18,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={stage}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="text-base text-muted"
          >
            {STAGES[stage]}…
          </motion.p>
        </AnimatePresence>
      </div>
    </section>
  );
}
