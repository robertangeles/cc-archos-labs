"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { GeneratedQuestion } from "@/lib/cdmp/generate";

interface QuestionCardProps {
  question: GeneratedQuestion;
  questionNumber: number;
  totalQuestions: number;
  onConfirm: (answerCode: string) => void;
}

export function ExamQuestionCard({
  question,
  questionNumber,
  totalQuestions,
  onConfirm,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function handleConfirm() {
    if (!selected || confirmed) return;
    setConfirmed(true);
    onConfirm(selected);
  }

  return (
    <motion.div
      key={question.questionText.slice(0, 40)}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="mx-auto w-full max-w-[720px] px-6 py-8 md:px-0"
    >
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium uppercase text-ink-subtle">
          Question {questionNumber} of {totalQuestions}
        </span>
        <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          {question.dmbokChapterRef}
        </span>
      </div>

      <h2 className="mt-4 text-lg font-medium leading-[1.4] text-ink md:text-xl">
        {question.questionText}
      </h2>

      <div className="mt-6 space-y-3">
        {question.options.map((option) => {
          const isSelected = selected === option.code;
          return (
            <button
              key={option.code}
              type="button"
              disabled={confirmed}
              onClick={() => setSelected(option.code)}
              className={`flex w-full items-start gap-3 rounded-lg border px-5 py-4 text-left transition-colors ${
                confirmed
                  ? isSelected
                    ? "border-primary bg-primary/5"
                    : "border-hairline bg-surface-1 opacity-60"
                  : isSelected
                    ? "border-primary bg-primary/5 text-ink"
                    : "border-hairline bg-surface-1 text-ink hover:border-primary/40"
              }`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                  isSelected
                    ? "border-primary bg-primary text-white"
                    : "border-ink-subtle/40 text-ink-subtle"
                }`}
              >
                {option.code}
              </span>
              <span className="text-sm leading-[1.5]">{option.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {selected && !confirmed && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              onClick={handleConfirm}
              className="mt-6 inline-flex items-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
            >
              Confirm answer
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
