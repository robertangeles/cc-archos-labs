"use client";

import { useCallback, useState } from "react";
import { LandingHero } from "./landing-hero";
import { ExamConfig } from "./exam-config";
import { ExamQuestionCard } from "./exam-question-card";
import { ExamProgressBar } from "./exam-progress-bar";
import { ExamResults, type AnswerDetail } from "./exam-results";
import type { GeneratedQuestion } from "@/lib/cdmp/generate";
import type { ExamResult } from "@/lib/cdmp/scoring";

type Phase = "landing" | "config" | "exam" | "loading" | "results";

interface ExamState {
  phase: Phase;
  sessionId: string | null;
  config: {
    questionCount: number;
    timerEnabled: boolean;
    timerSeconds: number;
    targetThreshold: number;
  } | null;
  questions: GeneratedQuestion[];
  currentIndex: number;
  answeredDetails: AnswerDetail[];
  result: ExamResult | null;
  error: string | null;
}

export function Exam() {
  const [state, setState] = useState<ExamState>({
    phase: "landing",
    sessionId: null,
    config: null,
    questions: [],
    currentIndex: 0,
    answeredDetails: [],
    result: null,
    error: null,
  });

  const handleStartExam = useCallback(
    async (config: {
      questionCount: number;
      timerEnabled: boolean;
    }) => {
      setState((prev) => ({ ...prev, phase: "loading", error: null }));

      try {
        const res = await fetch("/api/cdmp/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) {
            window.location.href = "/login?redirect=/tools/cdmp-practice";
            return;
          }
          if (res.status === 403) {
            window.location.href = "/account";
            return;
          }
          throw new Error(data.error || "Failed to start exam");
        }

        const data = await res.json();
        setState((prev) => ({
          ...prev,
          phase: "exam",
          sessionId: data.sessionId,
          config: data.config,
          questions: data.questions,
          currentIndex: 0,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          phase: "config",
          error: err instanceof Error ? err.message : "Something went wrong",
        }));
      }
    },
    [],
  );

  const handleAnswer = useCallback(
    async (answerCode: string) => {
      const question = state.questions[state.currentIndex];
      if (!question || !state.sessionId) return;

      const answerDetail: AnswerDetail = {
        questionIndex: state.currentIndex,
        questionText: question.questionText,
        options: question.options,
        userAnswer: answerCode,
        correctAnswer: question.correctAnswer,
        isCorrect: answerCode === question.correctAnswer,
        knowledgeArea: question.knowledgeArea,
        explanation: question.explanation,
        dmbokChapterRef: question.dmbokChapterRef,
      };

      await fetch("/api/cdmp/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          questionIndex: state.currentIndex,
          questionText: question.questionText,
          options: question.options,
          userAnswer: answerCode,
          correctAnswer: question.correctAnswer,
          knowledgeArea: question.knowledgeArea,
          explanation: question.explanation,
          dmbokChapterRef: question.dmbokChapterRef,
          chunkIds: question.chunkIds,
        }),
      });

      const nextIndex = state.currentIndex + 1;
      const updatedAnswers = [...state.answeredDetails, answerDetail];

      if (nextIndex >= state.questions.length) {
        setState((prev) => ({ ...prev, phase: "loading", answeredDetails: updatedAnswers }));

        const res = await fetch("/api/cdmp/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: state.sessionId }),
        });

        if (res.ok) {
          const data = await res.json();
          setState((prev) => ({
            ...prev,
            phase: "results",
            result: data.result,
          }));
        }
      } else {
        setState((prev) => ({
          ...prev,
          currentIndex: nextIndex,
          answeredDetails: updatedAnswers,
        }));
      }
    },
    [state.currentIndex, state.questions, state.sessionId, state.answeredDetails],
  );

  const handleTimerExpired = useCallback(async () => {
    if (!state.sessionId) return;
    setState((prev) => ({ ...prev, phase: "loading" }));

    const res = await fetch("/api/cdmp/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId }),
    });

    if (res.ok) {
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        phase: "results",
        result: data.result,
      }));
    }
  }, [state.sessionId]);

  const handleRetry = useCallback(() => {
    setState({
      phase: "config",
      sessionId: null,
      config: null,
      questions: [],
      currentIndex: 0,
      answeredDetails: [],
      result: null,
      error: null,
    });
  }, []);

  const handlePracticeWeak = useCallback(
    async (weakChapters: string[]) => {
      const questionCount = state.config?.questionCount ?? 20;
      setState((prev) => ({ ...prev, phase: "loading", error: null }));

      try {
        const res = await fetch("/api/cdmp/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionCount,
            timerEnabled: state.config?.timerEnabled ?? true,
            weakChapters,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) {
            window.location.href = "/login?redirect=/tools/cdmp-practice";
            return;
          }
          throw new Error(data.error || "Failed to start exam");
        }

        const data = await res.json();
        setState((prev) => ({
          ...prev,
          phase: "exam",
          sessionId: data.sessionId,
          config: data.config,
          questions: data.questions,
          currentIndex: 0,
          answeredDetails: [],
          result: null,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          phase: "config",
          error: err instanceof Error ? err.message : "Something went wrong",
        }));
      }
    },
    [state.config],
  );

  switch (state.phase) {
    case "landing":
      return (
        <LandingHero onStart={() => setState((p) => ({ ...p, phase: "config" }))} />
      );

    case "config":
      return (
        <div>
          {state.error && (
            <div className="mx-auto mt-4 max-w-[600px] rounded-lg border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
              {state.error}
            </div>
          )}
          <ExamConfig onBegin={handleStartExam} />
        </div>
      );

    case "loading":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-32">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-ink-subtle">
            Generating your practice exam...
          </p>
        </div>
      );

    case "exam": {
      if (state.questions.length === 0) {
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-32">
            <p className="text-lg font-medium text-ink">No questions generated</p>
            <p className="text-sm text-ink-subtle">
              The question generator could not create questions from the ingested content.
              Check that DMBOK documents are ingested and have status &quot;ready&quot; in the admin Knowledge Base.
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-4 rounded-md bg-primary px-6 py-3 text-sm font-medium text-white hover:bg-primary-hover"
            >
              Try again
            </button>
          </div>
        );
      }
      const question = state.questions[state.currentIndex];
      if (!question) return null;

      return (
        <div className="flex flex-1 flex-col">
          <ExamProgressBar
            current={state.currentIndex + 1}
            total={state.questions.length}
            timerEnabled={state.config?.timerEnabled ?? false}
            timerSeconds={state.config?.timerSeconds ?? 0}
            onTimerExpired={handleTimerExpired}
          />
          <ExamQuestionCard
            key={state.currentIndex}
            question={question}
            questionNumber={state.currentIndex + 1}
            totalQuestions={state.questions.length}
            onConfirm={handleAnswer}
          />
        </div>
      );
    }

    case "results":
      if (!state.result) return null;
      return <ExamResults result={state.result} answers={state.answeredDetails} onRetry={handleRetry} onPracticeWeak={handlePracticeWeak} />;
  }
}
