"use client";

import { motion } from "framer-motion";

// Welcome / start screen per spec §2.2 step 1. Direct, on-brand copy
// from spec §2.1 entry copy. Single Begin CTA — no clutter, no hand-
// holding, no fake stats. Audience is enterprise C-suite; trust them
// to read three sentences and decide.

export function WelcomeScreen({ onBegin }: { onBegin: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-1 flex-col bg-canvas px-6 py-24 md:px-12 md:py-32"
    >
      <div className="mx-auto flex w-full max-w-[680px] flex-col">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-primary">
          AI Readiness Assessment
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink md:text-[64px]">
          Most organisations believe their data is ready for AI.
          <br />
          <span className="text-primary">Most are wrong.</span>
        </h1>
        <p className="mt-8 max-w-[600px] text-[18px] leading-[1.6] text-ink-subtle">
          Twelve questions. About eight minutes. A practitioner-written
          report scoring your program across data foundation, program
          readiness, and organisational reality. No vendor pitch. No
          maturity wheel. No fake benchmarks.
        </p>
        <button
          type="button"
          onClick={onBegin}
          className="mt-12 inline-flex w-fit items-center rounded-md bg-primary px-8 py-3.5 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
        >
          Begin
        </button>
        <p className="mt-6 text-[13px] leading-[1.6] text-ink-subtle">
          Your answers stay on your device until you choose to receive
          your report.
        </p>
      </div>
    </motion.section>
  );
}
