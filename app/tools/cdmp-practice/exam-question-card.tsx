"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { GeneratedQuestion } from "@/lib/cdmp/generate";

interface QuestionCardProps {
  question: GeneratedQuestion;
  questionNumber: number;
  totalQuestions: number;
  previousAnswer?: string;
  onConfirm: (answerCode: string) => void;
  onPrevious?: () => void;
  onNavigate?: (index: number) => void;
  answeredCount: number;
}

export function ExamQuestionCard({
  question,
  questionNumber,
  totalQuestions,
  previousAnswer,
  onConfirm,
  onPrevious,
  onNavigate,
  answeredCount,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(
    previousAnswer ?? null,
  );
  const [confirmed, setConfirmed] = useState(!!previousAnswer);

  function handleConfirm() {
    if (!selected) return;
    setConfirmed(true);
    onConfirm(selected);
  }

  const isLast = questionNumber === totalQuestions;
  const allAnswered = answeredCount >= totalQuestions;

  return (
    <motion.div
      key={questionNumber}
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
              onClick={() => {
                setSelected(option.code);
                setConfirmed(false);
              }}
              className={`flex w-full items-start gap-3 rounded-lg border px-5 py-4 text-left transition-colors ${
                isSelected
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

      <div className="mt-6 flex items-center gap-3">
        {onPrevious && questionNumber > 1 && (
          <button
            type="button"
            onClick={onPrevious}
            className="inline-flex items-center rounded-md border border-hairline bg-surface-1 px-5 py-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-2"
          >
            Previous
          </button>
        )}

        <AnimatePresence>
          {selected && !confirmed && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              onClick={handleConfirm}
              className="inline-flex items-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
            >
              {previousAnswer ? "Update answer" : "Confirm answer"}
            </motion.button>
          )}
        </AnimatePresence>

        {confirmed && !isLast && (
          <button
            type="button"
            onClick={() => onNavigate?.(questionNumber)}
            className="inline-flex items-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
          >
            Next
          </button>
        )}

        {confirmed && isLast && allAnswered && (
          <button
            type="button"
            onClick={() => onNavigate?.(-1)}
            className="inline-flex items-center rounded-md bg-semantic-success px-6 py-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-semantic-success/90"
          >
            Finish exam
          </button>
        )}
      </div>

      {confirmed && !allAnswered && (
        <p className="mt-3 text-[11px] text-ink-subtle">
          {answeredCount}/{totalQuestions} answered
        </p>
      )}
    </motion.div>
  );
}
