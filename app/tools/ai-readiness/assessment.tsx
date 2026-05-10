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
import { ErrorScreen } from "./error-screen";
import { RegistrationGate, type LeadInput } from "./registration-gate";

// Single-page assessment per spec §2.2 + §7.
//
// State machine:
//
//   welcome → questions → registration → (redirect to /report/[id])
//                                       ↘ stays on registration with
//                                          errorMessage on API failure
//                              ↗
//                           catastrophic fetch error → error
//
// Persistence:
//   - Answers persist to localStorage so a refresh mid-flight resumes
//     where the user left off.
//   - Registration form values are NOT persisted — the form remains
//     mounted during the API call so a retry preserves them in
//     React state. A page refresh during submit returns the user to
//     the registration phase fresh.
//   - On successful POST to /api/diagnostic/generate the local state
//     is cleared and the user is redirected to the server-rendered
//     report page. The DB session row + report row + lead row become
//     the source of truth from that point.

const STORAGE_KEY = "archos-assessment-v1";

type Phase = "welcome" | "questions" | "registration" | "error";

interface SessionState {
  phase: Phase;
  answers: SessionAnswers;
  currentQuestionId: string | null;
  /** True while the registration POST is in flight. */
  registrationSubmitting?: boolean;
  /** Surfaced inline in the registration gate on API failure. */
  registrationError?: string;
  /** Surfaced on the full-screen ErrorScreen for catastrophic failures. */
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
      // If a refresh happened while a registration submit was in flight,
      // resume on the registration phase clean (no submitting flag).
      return {
        phase: parsed.phase as Phase,
        answers: parsed.answers,
        currentQuestionId: parsed.currentQuestionId ?? null,
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
    // Only persist the durable shape — don't write the transient
    // submitting/error flags to storage.
    const { phase, answers, currentQuestionId } = state;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ phase, answers, currentQuestionId }),
    );
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
        // Final answer — show registration gate (don't fire API yet).
        return {
          phase: "registration",
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

  async function onRegistrationSubmit(lead: LeadInput) {
    setState((prev) => ({
      ...prev,
      registrationSubmitting: true,
      registrationError: undefined,
    }));

    try {
      const res = await fetch("/api/diagnostic/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: state.answers, lead }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; sessionId?: string; error?: string }
        | null;

      if (res.ok && json?.ok && json.sessionId) {
        clearState();
        router.push(`/tools/ai-readiness/report/${json.sessionId}`);
        return;
      }

      // Inline error on the gate — keep form mounted so values persist
      setState((prev) => ({
        ...prev,
        registrationSubmitting: false,
        registrationError:
          json?.error ?? "We couldn't generate your report. Please try again.",
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        registrationSubmitting: false,
        registrationError: "Network error. Please try again.",
      }));
    }
  }

  function reset() {
    clearState();
    setState(INITIAL_STATE);
  }

  // Pre-hydration / welcome
  if (!hydrated || state.phase === "welcome") {
    return <WelcomeScreen onBegin={begin} />;
  }

  if (state.phase === "error") {
    return (
      <ErrorScreen
        message={state.errorMessage ?? "Something went wrong."}
        onRetry={reset}
      />
    );
  }

  if (state.phase === "registration") {
    return (
      <RegistrationGate
        onSubmit={onRegistrationSubmit}
        submitting={state.registrationSubmitting ?? false}
        errorMessage={state.registrationError}
      />
    );
  }

  // Questions phase
  const currentQuestion = state.currentQuestionId
    ? getQuestion(state.currentQuestionId)
    : null;

  if (!currentQuestion || !state.currentQuestionId) {
    // Stale state — reset rather than crash.
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

// Re-exports for tooling — kept stable in case test scripts move.
export type { SessionAnswers };
export { computeFlow };
