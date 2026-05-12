import { z } from "zod";

// Client-safe types + schema for the diagnostic prompt config. Server-
// only loader lives in lib/diagnostic/prompt-config.ts; admin UI imports
// from here so it never pulls server modules into the client bundle.
//
// One row in site_setting keyed 'diagnostic_prompt'. JSONB value matches
// DiagnosticPromptSchema.

export const DiagnosticPromptSchema = z.object({
  // The full system prompt sent to Claude on every report-generation
  // call. Owned by Rob — practitioner voice, output shape, forbidden
  // words, tone-by-tier matrix. Lives in the DB so it can be tuned
  // without a deploy.
  systemPrompt: z
    .string()
    .trim()
    .min(100, "System prompt is too short to be useful")
    .max(20000, "System prompt is too long (max 20k chars)"),
  // Free-form label for tracking which prompt produced which report.
  // Stamped onto each report_output row.
  version: z
    .string()
    .trim()
    .min(1, "Version label required")
    .max(40, "Version label too long"),
});

export type DiagnosticPrompt = z.infer<typeof DiagnosticPromptSchema>;

// Deliberately generic fallback — used only when no admin row exists.
// Public on the repo. Real practitioner-voice prompt is admin-seeded
// per CONTRIBUTING.md and never lives in source.
export const DIAGNOSTIC_PROMPT_FALLBACK: DiagnosticPrompt = {
  systemPrompt:
    "You are an AI assistant generating a structured JSON readiness report. " +
    "Respond ONLY with a JSON object of the shape " +
    `{"verdict": string, "narrative": string, "action_plan": [{"title": string, "explanation": string, "time_horizon": "immediate" | "30_days" | "90_days", "service_line": "ai_readiness_assessment" | "data_architecture" | "ai_agent_development"}]}. ` +
    "No prose before or after, no code fences. The real practitioner prompt is configured by an administrator and not present in source.",
  version: "fallback-v0",
};
