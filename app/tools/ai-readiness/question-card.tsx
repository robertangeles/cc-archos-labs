"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  BLOCK_LABELS,
  type AnswerCode,
  type Question,
} from "../../../lib/diagnostic/types";

// Single-question UI per spec §2.2 step 2. Block label as subtle
// orientation (Block 2 · Data foundation) — no branch indicator per
// spec ("user does not see a branch indicator"). Tap-card answers,
// not radios. Selected answer highlights brand blue then advances
// after a brief beat so the click feels acknowledged. No Next button.
//
// Wrapped by AnimatePresence in the parent (assessment.tsx) using a
// `key` per question — Framer Motion handles enter/exit transitions
// when the question changes.

const SELECTION_VISIBLE_MS = 180;

export function QuestionCard({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (code: AnswerCode) => void;
}) {
  const [selected, setSelected] = useState<AnswerCode | null>(null);

  function handleSelect(code: AnswerCode) {
    if (selected !== null) return;
    setSelected(code);
    setTimeout(() => onAnswer(code), SELECTION_VISIBLE_MS);
  }

  return (
    <motion.div
      key={question.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="flex flex-1 flex-col px-6 py-12 md:px-12 md:py-16"
    >
      <div className="mx-auto flex w-full max-w-[760px] flex-col">
        <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-subtle">
          Block {question.block} · {BLOCK_LABELS[question.block]}
        </p>
        <h2 className="mt-4 text-2xl font-semibold leading-[1.2] tracking-[-0.015em] text-ink md:text-[36px]">
          {question.text}
        </h2>

        <div className="mt-10 flex flex-col gap-y-2.5">
          {question.options.map((opt) => {
            const isSelected = selected === opt.code;
            const isLocked = selected !== null && !isSelected;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => handleSelect(opt.code)}
                disabled={selected !== null}
                className={`group flex items-start gap-x-5 rounded-lg border px-5 py-4 text-left transition-all duration-150 md:px-6 md:py-5 ${
                  isSelected
                    ? "border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(94,106,210,0.4)]"
                    : isLocked
                      ? "border-hairline/60 bg-surface-1/40 opacity-60"
                      : "border-hairline bg-surface-1 hover:border-primary/50 hover:bg-surface-1/80"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-[12px] font-semibold transition-colors duration-150 ${
                    isSelected
                      ? "border-primary bg-primary text-white"
                      : "border-hairline text-ink-subtle group-hover:border-primary/60 group-hover:text-ink"
                  }`}
                >
                  {opt.code}
                </span>
                <span
                  className={`flex-1 pt-0.5 text-base leading-[1.5] transition-colors duration-150 ${
                    isSelected ? "text-ink" : "text-ink/90"
                  }`}
                >
                  {opt.label}
                  {opt.description ? (
                    <span className="mt-1 block text-sm leading-[1.5] text-ink-subtle">
                      {opt.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
