import type { AnswerCode } from "./types";

// Question flow logic for the AI Readiness Assessment per spec §2.2
// + §3 + §4. Computes the ordered list of questions a user will see
// given their answers so far. Re-runs every time the user submits an
// answer because branches and replacements depend on prior answers.
//
// Two distinct mechanisms:
//
//   - INSERTION: a branch question is added between its parent and the
//     next base question (Q6→Q6a/Q6b, Q9→Q9c/Q9d, Q10→Q10a).
//
//   - REPLACEMENT: Q9 is REPLACED entirely by Q9a (Q3=A/B) or Q9b
//     (Q3=D). When replaced, Q9 is not asked at all — and Q9c/Q9d
//     (which depend on Q9 being asked) are also skipped. Q9 only fires
//     when Q3=C ("AI in production but not scaling").

// Stored as a session's accumulated answers. Question IDs map to the
// answer code the user picked.
export type SessionAnswers = Partial<Record<string, AnswerCode>>;

// The full base flow before any branches/replacements. Q9's place in
// the order is fixed; the resolver below decides whether Q9 stays,
// gets replaced by Q9a, or gets replaced by Q9b.
const BASE_ORDER = [
  "q1",
  "q2",
  "q3",
  "q4",
  "q5",
  "q6",
  // Q6 branch slot (Q6a or Q6b) inserted here
  "q7",
  "q8",
  // Q9 slot — replaced by Q9a/Q9b based on Q3, or kept + Q9c/Q9d slot
  "q10",
  // Q10a inserted here when Q10=D
  "q11",
  "q12",
] as const;

// Computes the ordered list of question IDs the session will see given
// the answers collected so far. Pure: no side effects, deterministic.
export function computeFlow(answers: SessionAnswers): string[] {
  const flow: string[] = [];

  // Block 1 + start of Block 2: q1–q6 always appear in this order.
  flow.push("q1", "q2", "q3", "q4", "q5", "q6");

  // Q6 branch insertion
  if (answers.q6 === "A") {
    flow.push("q6a");
  } else if (answers.q6 === "D") {
    flow.push("q6b");
  }

  // Q7, Q8 always next
  flow.push("q7", "q8");

  // Q9 replacement logic per spec §3.2 (Q3 branch trigger)
  if (answers.q3 === "A" || answers.q3 === "B") {
    // Replace Q9 with Q9a — Q9 is NOT asked, and Q9c/Q9d (which
    // depend on Q9 being answered) are NOT asked either.
    flow.push("q9a");
  } else if (answers.q3 === "D") {
    // Replace Q9 with Q9b — same skip semantics for Q9 + Q9c/Q9d.
    flow.push("q9b");
  } else {
    // Q3 = C (or not yet answered) — Q9 fires normally + Q9c/Q9d
    // potentially follow.
    flow.push("q9");
    if (answers.q9 === "A") {
      flow.push("q9d");
    } else if (answers.q9 === "C") {
      flow.push("q9c");
    }
  }

  // Block 3 — Q10, Q10a (conditional), Q11, Q12
  flow.push("q10");
  if (answers.q10 === "D") {
    flow.push("q10a");
  }
  flow.push("q11", "q12");

  return flow;
}

// First question of the assessment — always Q1.
export function getInitialQuestionId(): string {
  return BASE_ORDER[0];
}

// Returns the next question ID given the current answers and the ID
// of the question just answered. Returns null when the session is
// complete (all questions in the resolved flow have been asked).
export function getNextQuestionId(
  answers: SessionAnswers,
  currentId: string,
): string | null {
  const flow = computeFlow(answers);
  const idx = flow.indexOf(currentId);
  if (idx === -1) {
    // Defensive: caller asked about a question that's not in the
    // current flow. Restart from the beginning.
    return flow[0] ?? null;
  }
  if (idx === flow.length - 1) return null;
  return flow[idx + 1];
}

// True when every question in the resolved flow has an answer recorded.
export function isSessionComplete(answers: SessionAnswers): boolean {
  const flow = computeFlow(answers);
  return flow.every((qid) => answers[qid] !== undefined);
}

// 0-based index of `currentId` within the resolved flow, plus the total.
// Used for the progress bar. Total can shift as branches resolve, which
// is fine — UI shows live state, not a pre-committed denominator.
export function getProgress(
  answers: SessionAnswers,
  currentId: string,
): { index: number; total: number; percent: number } {
  const flow = computeFlow(answers);
  const idx = Math.max(0, flow.indexOf(currentId));
  const total = flow.length;
  const percent = total === 0 ? 0 : Math.round((idx / total) * 100);
  return { index: idx, total, percent };
}
