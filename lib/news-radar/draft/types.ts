import type { ChatResult } from "./llm";
import type { AttentionReason } from "./jobs";

/** What one finished stage leaves behind: the audit trail and the cost. */
export interface StepLog {
  stepKey: string;
  status: "ok" | "failed";
  output: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
}

export function stepFromChat(stepKey: string, r: ChatResult, output: string = r.text): StepLog {
  return {
    stepKey,
    status: "ok",
    output,
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
  };
}

/** A stage that decided a person must look. */
export interface Stop {
  ok: false;
  reason: AttentionReason;
  detail: string;
}

export const stop = (reason: AttentionReason, detail: string): Stop => ({ ok: false, reason, detail });
