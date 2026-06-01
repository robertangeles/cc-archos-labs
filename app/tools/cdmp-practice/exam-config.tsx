"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface ExamConfigProps {
  onBegin: (config: {
    questionCount: number;
    timerEnabled: boolean;
  }) => void;
}

const QUESTION_COUNTS = [
  { value: 20, label: "20 questions", time: "18 min" },
  { value: 40, label: "40 questions", time: "36 min" },
  { value: 60, label: "60 questions", time: "54 min" },
  { value: 100, label: "100 questions", time: "90 min", badge: "Full exam" },
];

export function ExamConfig({ onBegin }: ExamConfigProps) {
  const [questionCount, setQuestionCount] = useState(100);
  const [timerEnabled, setTimerEnabled] = useState(true);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-1 flex-col bg-canvas px-6 py-16 md:px-12 md:py-24"
    >
      <div className="mx-auto flex w-full max-w-[600px] flex-col">
        <p className="uppercase text-eyebrow text-ink-subtle">
          Configure your exam
        </p>
        <h2 className="mt-4 text-2xl font-semibold text-ink md:text-3xl">
          How do you want to practice?
        </h2>

        <div className="mt-10">
          <label className="text-sm font-medium text-ink">
            Number of questions
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {QUESTION_COUNTS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setQuestionCount(opt.value)}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  questionCount === opt.value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-hairline bg-surface-1 text-ink hover:border-primary/40"
                }`}
              >
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs text-ink-subtle">{opt.time}</span>
                {opt.badge && (
                  <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {opt.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-ink">Timer</p>
            <p className="text-xs text-ink-subtle">
              Proportional to the real 90-minute exam
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTimerEnabled(!timerEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
              timerEnabled ? "bg-primary" : "bg-ink-subtle/30"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                timerEnabled ? "translate-x-[22px]" : "translate-x-0.5"
              } mt-0.5`}
            />
          </button>
        </div>

        <div className="mt-8 rounded-lg border border-hairline bg-surface-1 px-5 py-4 text-[13px] leading-[1.6] text-ink-subtle">
          <p>
            Every attempt generates a fresh set of questions — no two exams are the same.
          </p>
          <p className="mt-1">
            Generation time: ~20 questions takes about 30 seconds, 100 questions takes 2-3 minutes. The timer starts after questions are ready.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onBegin({ questionCount, timerEnabled })}
          className="mt-6 inline-flex w-fit items-center rounded-md bg-primary px-8 py-3.5 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
        >
          Begin exam
        </button>
      </div>
    </motion.section>
  );
}
