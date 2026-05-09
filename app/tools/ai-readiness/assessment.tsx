"use client";

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { getQuestion } from "../../../lib/diagnostic/content";
import {
  computeFlow,
  getInitialQuestionId,
  getNextQuestionId,
  getProgress,
  type SessionAnswers,
} from "../../../lib/diagnostic/flow";
import {
  evaluateSession,
  type SessionResult,
} from "../../../lib/diagnostic/scoring";
import type { AnswerCode } from "../../../lib/diagnostic/types";
import { WelcomeScreen } from "./welcome-screen";
import { QuestionCard } from "./question-card";
import { ProgressBar } from "./progress-bar";
import { ResultDebug } from "./result-debug";

// Single-page assessment per spec §2.2. State machine has three phases:
//   welcome → questions → complete
// Answers persist to localStorage so a refresh mid-flight resumes
// where the user left off. Server has no state for the assessment
// itself in W2; W3 adds the assessment_session DB write at completion
// and W4 adds the registration gate between complete and report.

const STORAGE_KEY = "archos-assessment-v1";

type Phase = "welcome" | "questions" | "complete";

interface SessionState {
  phase: Phase;
  answers: SessionAnswers;
  currentQuestionId: string | null;
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
    // Validate shape — never trust localStorage to be well-formed.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.phase === "string" &&
      typeof parsed.answers === "object" &&
      parsed.answers !== null
    ) {
      return {
        phase: parsed.phase as Phase,
        answers: parsed.answers,
        currentQuestionId: parsed.currentQuestionId ?? null,
      };
    }
  } catch {
    // Bad JSON / parse error — start fresh
  }
  return INITIAL_STATE;
}

function persistState(state: SessionState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded / private browsing — fail soft
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
  // Render the welcome screen on SSR + initial paint. Hydrate from
  // localStorage in an effect so a returning user resumes their
  // session. Brief flicker on resume is acceptable.
  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);

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
      return {
        phase: nextId ? "questions" : "complete",
        answers: newAnswers,
        currentQuestionId: nextId,
      };
    });
  }

  function reset() {
    clearState();
    setState(INITIAL_STATE);
  }

  // Welcome phase — also covers the SSR + pre-hydration render
  if (!hydrated || state.phase === "welcome") {
    return <WelcomeScreen onBegin={begin} />;
  }

  // Complete phase — debug view; W3 replaces with the Claude report
  if (state.phase === "complete") {
    const result: SessionResult = evaluateSession(state.answers);
    return (
      <ResultDebug
        result={result}
        answers={state.answers as Record<string, AnswerCode>}
        onReset={reset}
      />
    );
  }

  // Questions phase
  const currentQuestion = state.currentQuestionId
    ? getQuestion(state.currentQuestionId)
    : null;

  if (!currentQuestion || !state.currentQuestionId) {
    // Defensive — stale state pointing at a question that doesn't
    // exist in the resolved flow. Reset rather than crash.
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

// Re-export for the route to silence "unused" warnings if computeFlow
// types ever change. No runtime impact.
export type { SessionAnswers };
export { computeFlow };
