"use client";

import { useState } from "react";

export interface SpecialistAreaOption {
  slug: string;
  label: string;
  maxQuestions: number;
}

export interface ExamBeginConfig {
  mode: "fundamentals" | "specialist";
  specialistArea?: string;
  questionCount: number;
  timerEnabled: boolean;
}

interface ExamConfigProps {
  onBegin: (config: ExamBeginConfig) => void;
  specialistAreas: SpecialistAreaOption[];
  // When deep-linked from a specialist landing page, the subject is pre-locked
  // (shown as a confirmed chip, not re-picked).
  lockedArea?: SpecialistAreaOption | null;
}

const QUESTION_COUNTS = [
  { value: 20, label: "20 questions", time: "18 min" },
  { value: 40, label: "40 questions", time: "36 min" },
  { value: 60, label: "60 questions", time: "54 min" },
  { value: 100, label: "100 questions", time: "90 min", badge: "Full exam" },
];

export function ExamConfig({ onBegin, specialistAreas, lockedArea }: ExamConfigProps) {
  const [mode, setMode] = useState<"fundamentals" | "specialist">(
    lockedArea ? "specialist" : "fundamentals",
  );
  const [areaSlug, setAreaSlug] = useState<string | null>(lockedArea?.slug ?? null);
  const [questionCount, setQuestionCount] = useState(lockedArea ? 40 : 100);
  const [timerEnabled, setTimerEnabled] = useState(true);

  const selectedArea =
    mode === "specialist"
      ? lockedArea ?? specialistAreas.find((a) => a.slug === areaSlug) ?? null
      : null;
  const maxQuestions =
    mode === "specialist" ? selectedArea?.maxQuestions ?? 0 : Infinity;
  const canBegin =
    mode === "fundamentals" ||
    (selectedArea !== null && questionCount <= maxQuestions);

  function pickArea(area: SpecialistAreaOption) {
    setAreaSlug(area.slug);
    // Clamp the count if the previously chosen value exceeds this subject's cap.
    if (questionCount > area.maxQuestions) setQuestionCount(40);
  }

  return (
    <section className="flex flex-1 flex-col bg-canvas px-6 py-16 md:px-12 md:py-24">

      <div className="mx-auto flex w-full max-w-[600px] flex-col">
        <p className="uppercase text-eyebrow text-ink-subtle">
          Configure your exam
        </p>
        <h2 className="mt-4 text-2xl font-semibold text-ink md:text-3xl">
          How do you want to practice?
        </h2>

        {/* Mode — hidden when a landing page locked the subject */}
        {!lockedArea && (
          <div className="mt-8">
            <div
              role="radiogroup"
              aria-label="Exam type"
              className="grid grid-cols-2 gap-1 rounded-lg border border-hairline bg-surface-1 p-1"
            >
              {(["fundamentals", "specialist"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
                    mode === m
                      ? "bg-primary text-white"
                      : "text-ink-subtle hover:text-ink"
                  }`}
                >
                  {m === "fundamentals" ? "Fundamentals" : "Specialist"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-subtle">
              {mode === "fundamentals"
                ? "All 14 knowledge areas, weighted like the real exam."
                : "One subject in depth — questions scoped to a single DMBOK chapter."}
            </p>
          </div>
        )}

        {/* Specialist subject — locked chip or 7-area picker */}
        {mode === "specialist" && (
          <div className="mt-8">
            <label className="text-sm font-medium text-ink">Subject</label>
            {lockedArea ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-primary bg-primary/5 px-4 py-2.5 text-sm font-medium text-primary">
                {lockedArea.label}
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label="Subject"
                className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                {specialistAreas.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    role="radio"
                    aria-checked={areaSlug === a.slug}
                    onClick={() => pickArea(a)}
                    className={`rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors ${
                      areaSlug === a.slug
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-hairline bg-surface-1 text-ink hover:border-primary/40"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Number of questions — counts above the subject cap are disabled */}
        <div className="mt-8">
          <label className="text-sm font-medium text-ink">
            Number of questions
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {QUESTION_COUNTS.map((opt) => {
              const disabled = opt.value > maxQuestions;
              const selected = questionCount === opt.value && !disabled;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled}
                  aria-disabled={disabled}
                  onClick={() => setQuestionCount(opt.value)}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                    disabled
                      ? "cursor-not-allowed border-hairline bg-surface-1 opacity-40"
                      : selected
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-hairline bg-surface-1 text-ink hover:border-primary/40"
                  }`}
                >
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="block text-xs text-ink-subtle">{opt.time}</span>
                  {opt.badge && !disabled && (
                    <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {opt.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {mode === "specialist" && selectedArea && (
            <p className="mt-2 text-xs text-ink-subtle">
              {selectedArea.label} supports up to {selectedArea.maxQuestions}{" "}
              questions right now.
            </p>
          )}
        </div>

        {/* Timer */}
        <div className="mt-8 flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-ink">Timer</p>
            <p className="text-xs text-ink-subtle">
              Proportional to the real 90-minute exam
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={timerEnabled}
            aria-label="Timer"
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
            Every attempt generates a fresh set of questions — no two exams are
            the same.
          </p>
          <p className="mt-1">
            Generation takes ~30 seconds for 20 questions, a few minutes for
            larger sets. The timer starts after questions are ready.
          </p>
        </div>

        <button
          type="button"
          disabled={!canBegin}
          onClick={() =>
            onBegin({
              mode,
              specialistArea: selectedArea?.slug,
              questionCount,
              timerEnabled,
            })
          }
          className={`mt-6 inline-flex w-fit items-center rounded-md px-8 py-3.5 text-base font-medium text-white transition-colors duration-150 ${
            canBegin
              ? "bg-primary hover:bg-primary-hover"
              : "cursor-not-allowed bg-ink-subtle/30"
          }`}
        >
          Begin exam
        </button>
        {mode === "specialist" && !selectedArea && (
          <p className="mt-2 text-xs text-ink-subtle">
            Pick a subject to begin.
          </p>
        )}
      </div>
    </section>
  );
}
