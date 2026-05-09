"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { getQuestion } from "../../../lib/diagnostic/content";
import {
  computeFlow,
  getInitialQuestionId,
  getNextQuestionId,
  getProgress,
  type SessionAnswers,
} from "../../../lib/diagnostic/flow";
import type { AnswerCode } from "../../../lib/diagnostic/types";
import { WelcomeScreen } from "./welcome-screen";
import { QuestionCard } from "./question-card";
import { ProgressBar } from "./progress-bar";
import { SubmittingScreen } from "./submitting-screen";
import { ErrorScreen } from "./error-screen";

// Single-page assessment per spec §2.2. State machine has four phases
// after initial welcome:
//
//   welcome → questions → submitting → (redirect to /report/[id])
//                                    ↘ error → (retry → submitting)
//
// Persistence:
//   - Answers persist to localStorage so a refresh mid-flight resumes
//     where the user left off.
//   - On successful POST to /api/diagnostic/generate the local state
//     is cleared and the user is redirected to the server-rendered
//     report page. The DB session row + report row become the source
//     of truth from that point.

const STORAGE_KEY = "archos-assessment-v1";

type Phase = "welcome" | "questions" | "submitting" | "error";

interface SessionState {
  phase: Phase;
  answers: SessionAnswers;
  currentQuestionId: string | null;
  errorMessage?: string;
}

const INITIAL_STATE: SessionState = {
  phase: "welcome",
  answers: {},
  currentQuestionId: null,
};

function loadState(): SessionState {
  if (typeof window === "undefined") return INITIAL_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.phase === "string" &&
      typeof parsed.answers === "object" &&
      parsed.answers !== null
    ) {
      // Never restore the transient `submitting` phase on load — if a
      // refresh happened while a request was in flight, fall back to
      // the questions phase positioned on the last unanswered question
      // (or to error so the user can retry).
      const phase = (parsed.phase as Phase) === "submitting"
        ? "error"
        : (parsed.phase as Phase);
      return {
        phase,
        answers: parsed.answers,
        currentQuestionId: parsed.currentQuestionId ?? null,
        errorMessage:
          phase === "error"
            ? "We weren't able to finish generating your report. Please try again."
            : undefined,
      };
    }
  } catch {
    // ignore parse errors — fall through to fresh state
  }
  return INITIAL_STATE;
}

function persistState(state: SessionState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota / privacy mode — fail soft
  }
}

function clearState() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function Assessment() {
  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    persistState(state);
  }, [state, hydrated]);

  function begin() {
    setState({
      phase: "questions",
      answers: {},
      currentQuestionId: getInitialQuestionId(),
    });
  }

  function answerCurrent(questionId: string, code: AnswerCode) {
    setState((prev) => {
      const newAnswers: SessionAnswers = {
        ...prev.answers,
        [questionId]: code,
      };
      const nextId = getNextQuestionId(newAnswers, questionId);
      if (nextId === null) {
        // Last answer — transition to submitting and fire the request.
        // We deliberately update local state synchronously then submit
        // out-of-band so the UI swaps to the staged-progress screen
        // immediately.
        void submit(newAnswers);
        return {
          phase: "submitting",
          answers: newAnswers,
          currentQuestionId: null,
        };
      }
      return {
        phase: "questions",
        answers: newAnswers,
        currentQuestionId: nextId,
      };
    });
  }

  async function submit(answers: SessionAnswers) {
    try {
      const res = await fetch("/api/diagnostic/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; sessionId?: string; error?: string }
        | null;

      if (res.ok && json?.ok && json.sessionId) {
        clearState();
        router.push(`/tools/ai-readiness/report/${json.sessionId}`);
        return;
      }

      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage:
          json?.error ?? "We couldn't generate your report. Please try again.",
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage: "Network error. Please try again.",
      }));
    }
  }

  function retrySubmit() {
    if (Object.keys(state.answers).length === 0) {
      // No answers to retry with — return to welcome
      setState(INITIAL_STATE);
      return;
    }
    setState((prev) => ({ ...prev, phase: "submitting", errorMessage: undefined }));
    void submit(state.answers);
  }

  function reset() {
    clearState();
    setState(INITIAL_STATE);
  }

  // Pre-hydration / welcome
  if (!hydrated || state.phase === "welcome") {
    return <WelcomeScreen onBegin={begin} />;
  }

  if (state.phase === "submitting") {
    return <SubmittingScreen />;
  }

  if (state.phase === "error") {
    return (
      <ErrorScreen
        message={state.errorMessage ?? "Something went wrong."}
        onRetry={retrySubmit}
      />
    );
  }

  // Questions phase
  const currentQuestion = state.currentQuestionId
    ? getQuestion(state.currentQuestionId)
    : null;

  if (!currentQuestion || !state.currentQuestionId) {
    // Stale state pointing at a question that doesn't exist in the
    // current flow. Reset rather than crash.
    reset();
    return <WelcomeScreen onBegin={begin} />;
  }

  const progress = getProgress(state.answers, state.currentQuestionId);

  return (
    <div className="flex flex-1 flex-col">
      <ProgressBar
        percent={progress.percent}
        index={progress.index}
        total={progress.total}
      />
      <AnimatePresence mode="wait">
        <QuestionCard
          key={currentQuestion.id}
          question={currentQuestion}
          onAnswer={(code) => answerCurrent(currentQuestion.id, code)}
        />
      </AnimatePresence>
    </div>
  );
}

// Re-exports kept for tooling (none currently consume these from this
// file but keeping the surface stable in case test scripts move).
export type { SessionAnswers };
export { computeFlow };
