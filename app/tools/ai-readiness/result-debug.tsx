"use client";

import { motion } from "framer-motion";
import {
  DOMAIN_LABELS,
  type AnswerCode,
  type Domain,
} from "../../../lib/diagnostic/types";
import type { SessionResult } from "../../../lib/diagnostic/scoring";

// Debug-only completion view. W3 replaces this with the Claude-
// generated practitioner report (verdict + narrative + priority
// actions); W4 adds the registration gate before this screen.

const sevColours: Record<string, string> = {
  critical: "border-[#f87171]/40 bg-[#f87171]/5 text-[#f87171]",
  high: "border-[#fb923c]/40 bg-[#fb923c]/5 text-[#fb923c]",
  medium: "border-[#fbbf24]/40 bg-[#fbbf24]/5 text-[#fbbf24]",
};

export function ResultDebug({
  result,
  onReset,
}: {
  result: SessionResult;
  answers: Record<string, AnswerCode>;
  onReset: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-1 flex-col bg-canvas px-6 py-20 md:px-12 md:py-24"
    >
      <div className="mx-auto flex w-full max-w-[760px] flex-col">
        <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-accent">
          Assessment complete · debug view
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-fg md:text-[56px]">
          {result.tier.label}
        </h1>
        <p className="mt-3 text-[18px] leading-[1.6] text-muted">
          <span className="text-fg">{result.tier.tier} tier</span>
          <span className="mx-2 text-muted/60">·</span>
          <span className="font-mono">{result.score.total} / 100</span>
        </p>

        {/* Domain breakdown */}
        <div className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-3">
          {(["data_foundation", "program_readiness", "org_reality"] as Domain[]).map(
            (key) => {
              const ds = result.score[key];
              return (
                <div
                  key={key}
                  className="rounded-md border border-rule bg-surface px-4 py-4"
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                    {DOMAIN_LABELS[key]}
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-fg">
                    {ds.percent}%
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-muted">
                    {ds.raw} / {ds.max}
                  </p>
                </div>
              );
            },
          )}
        </div>

        {/* Risk flags */}
        {result.riskFlags.length > 0 ? (
          <div className="mt-10">
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
              Risk flags
            </p>
            <ul className="mt-3 flex flex-col gap-y-2">
              {result.riskFlags.map((f) => (
                <li
                  key={f.code}
                  className={`rounded-md border px-4 py-3 ${sevColours[f.severity] ?? ""}`}
                >
                  <p className="text-[11px] font-mono uppercase tracking-[0.1em]">
                    {f.severity}
                  </p>
                  <p className="mt-1 text-sm leading-[1.5] text-fg/90">
                    {f.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Priority lead callout */}
        {result.isPriority ? (
          <div className="mt-6 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-accent">
              Priority lead
            </p>
            <p className="mt-1 text-sm leading-[1.5] text-fg/90">
              {result.priorityReasons[0]}
            </p>
          </div>
        ) : null}

        {/* W3 replacement note */}
        <div className="mt-12 rounded-md border border-dashed border-rule px-4 py-3 text-sm leading-[1.5] text-muted">
          This is a debug view. W3 replaces it with a Claude-generated
          practitioner report. W4 adds the registration gate before
          this screen.
        </div>

        <button
          type="button"
          onClick={onReset}
          className="mt-8 w-fit text-sm text-muted transition-colors duration-150 hover:text-fg"
        >
          Reset and start over
        </button>
      </div>
    </motion.section>
  );
}
