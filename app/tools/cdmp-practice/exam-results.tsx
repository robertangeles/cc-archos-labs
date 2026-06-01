"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ExamResult } from "@/lib/cdmp/scoring";

export interface AnswerDetail {
  questionIndex: number;
  questionText: string;
  options: Array<{ code: string; label: string }>;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  knowledgeArea: string;
  explanation: string;
  dmbokChapterRef: string;
}

interface ExamResultsProps {
  result: ExamResult;
  answers: AnswerDetail[];
  onRetry: () => void;
}

export function ExamResults({ result, answers, onRetry }: ExamResultsProps) {
  const [selectedQuestion, setSelectedQuestion] = useState<number | null>(null);
  const [showReview, setShowReview] = useState(false);

  const sortedAnswers = [...answers].sort(
    (a, b) => a.questionIndex - b.questionIndex,
  );
  const selected = sortedAnswers.find(
    (a) => a.questionIndex === selectedQuestion,
  );

  const bestThreshold = result.thresholds.master.passed
    ? "Master"
    : result.thresholds.practitioner.passed
      ? "Practitioner"
      : result.thresholds.associate.passed
        ? "Associate"
        : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-1 flex-col bg-canvas px-6 py-16 md:px-12 md:py-24"
    >
      <div className="mx-auto w-full max-w-[720px]">
        <p className="uppercase text-eyebrow text-ink-subtle">Exam Results</p>

        <div className="mt-6 flex items-end gap-4">
          <span className="text-6xl font-bold text-ink md:text-7xl">
            {result.percentCorrect}%
          </span>
          <div className="mb-2">
            {bestThreshold ? (
              <span className="inline-block rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">
                {bestThreshold} level reached
              </span>
            ) : (
              <span className="inline-block rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800">
                Below Associate threshold
              </span>
            )}
          </div>
        </div>

        <p className="mt-3 text-sm text-ink-subtle">
          {result.correctCount} correct out of {result.totalQuestions} questions
        </p>

        <div className="mt-4 flex gap-4 text-xs text-ink-subtle">
          <span>
            Associate (60%):{" "}
            <strong
              className={
                result.thresholds.associate.passed
                  ? "text-green-700"
                  : "text-red-600"
              }
            >
              {result.thresholds.associate.passed ? "Passed" : "Not met"}
            </strong>
          </span>
          <span>
            Practitioner (70%):{" "}
            <strong
              className={
                result.thresholds.practitioner.passed
                  ? "text-green-700"
                  : "text-red-600"
              }
            >
              {result.thresholds.practitioner.passed ? "Passed" : "Not met"}
            </strong>
          </span>
          <span>
            Master (80%):{" "}
            <strong
              className={
                result.thresholds.master.passed
                  ? "text-green-700"
                  : "text-red-600"
              }
            >
              {result.thresholds.master.passed ? "Passed" : "Not met"}
            </strong>
          </span>
        </div>

        <p className="mt-2 text-[11px] text-ink-subtle">
          Practitioner and Master require passing 2 additional specialist exams.
        </p>

        <h3 className="mt-12 text-lg font-semibold text-ink">
          Performance by DMBOK Chapter
        </h3>
        <p className="mt-1 text-sm text-ink-subtle">
          Focus your study on chapters with the lowest scores.
        </p>

        <div className="mt-6 space-y-3">
          {result.perChapter
            .sort((a, b) => a.percentCorrect - b.percentCorrect)
            .map((chapter) => (
                <div key={chapter.slug}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink">
                      {chapter.label}
                    </span>
                    <span className="text-ink-subtle">
                      {chapter.correctCount}/{chapter.totalQuestions} (
                      {chapter.percentCorrect}%)
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-ink-subtle/10">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        chapter.percentCorrect >= 80
                          ? "bg-green-500"
                          : chapter.percentCorrect >= 60
                            ? "bg-yellow-500"
                            : "bg-red-500"
                      }`}
                      style={{ width: `${chapter.percentCorrect}%` }}
                    />
                  </div>
                </div>
            ))}
        </div>

        <div className="mt-12">
          <button
            type="button"
            onClick={() => {
              setShowReview(!showReview);
              if (!showReview) setSelectedQuestion(null);
            }}
            className="text-sm font-medium text-primary hover:text-primary-hover"
          >
            {showReview
              ? "Hide question review"
              : "Review all questions with answers"}
          </button>
        </div>

        {showReview && sortedAnswers.length > 0 && (
          <div className="mt-6">
            <p className="mb-3 text-xs text-ink-subtle">
              Select a question to review. Green = correct. Red = incorrect.
            </p>

            <div className="flex flex-wrap gap-2">
              {sortedAnswers.map((answer) => {
                const isSelected = selectedQuestion === answer.questionIndex;
                return (
                  <button
                    key={answer.questionIndex}
                    type="button"
                    onClick={() =>
                      setSelectedQuestion(
                        isSelected ? null : answer.questionIndex,
                      )
                    }
                    className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      isSelected
                        ? "ring-2 ring-primary ring-offset-1 ring-offset-canvas"
                        : ""
                    } ${
                      answer.isCorrect
                        ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                        : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                    }`}
                  >
                    {answer.questionIndex + 1}
                  </button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              {selected && (
                <motion.div
                  key={selected.questionIndex}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="mt-4 rounded-lg border border-hairline bg-surface-1 p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm leading-relaxed text-ink">
                      {selected.questionText}
                    </p>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${
                        selected.isCorrect
                          ? "bg-green-600/20 text-green-400"
                          : "bg-red-600/20 text-red-400"
                      }`}
                    >
                      {selected.isCorrect ? "Correct" : "Incorrect"}
                    </span>
                  </div>

                  <p className="mt-1.5 text-[11px] text-ink-subtle">
                    {selected.dmbokChapterRef}
                  </p>

                  <div className="mt-4 space-y-1.5">
                    {selected.options.map((opt) => {
                      const isUserAnswer = opt.code === selected.userAnswer;
                      const isCorrectAnswer =
                        opt.code === selected.correctAnswer;

                      let style = "border-transparent bg-ink-subtle/5";
                      let badge = "";

                      if (isCorrectAnswer) {
                        style = "border-green-500/50 bg-green-500/10";
                        badge = isUserAnswer
                          ? "Your answer (correct)"
                          : "Correct answer";
                      } else if (isUserAnswer) {
                        style = "border-red-500/50 bg-red-500/10";
                        badge = "Your answer";
                      }

                      return (
                        <div
                          key={opt.code}
                          className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${style}`}
                        >
                          <span
                            className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                              isCorrectAnswer
                                ? "bg-green-600 text-white"
                                : isUserAnswer
                                  ? "bg-red-600 text-white"
                                  : "bg-ink-subtle/20 text-ink-subtle"
                            }`}
                          >
                            {opt.code}
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="text-[13px] leading-snug text-ink">
                              {opt.label}
                            </span>
                            {badge && (
                              <span className="ml-2 text-[10px] font-medium text-ink-subtle">
                                {badge}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 border-t border-hairline pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                      Explanation
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-subtle">
                      {selected.explanation}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="mt-12 flex gap-4">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
          >
            Try again
          </button>
        </div>
      </div>
    </motion.section>
  );
}
