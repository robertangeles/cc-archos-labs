"use client";

import { motion } from "framer-motion";

// Sticky progress bar visible during the questions phase per spec §2.2.
// Shows current/total verbatim ("Question 5 of 12") so the user knows
// how much is left. Total can shift live as branches resolve — that's
// honest, not jarring; the bar just smooths to the new percent.

export function ProgressBar({
  percent,
  index,
  total,
}: {
  percent: number;
  index: number;
  total: number;
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-rule/50 bg-canvas/90 px-6 pt-6 pb-4 backdrop-blur-md md:px-12">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
          <span>AI Readiness Assessment</span>
          <span className="font-mono">
            {index + 1} of {total}
          </span>
        </div>
        <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-rule/60">
          <motion.div
            className="h-full rounded-full bg-accent"
            initial={false}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
      </div>
    </div>
  );
}
