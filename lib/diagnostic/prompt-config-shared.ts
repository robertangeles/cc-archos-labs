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

// Starter template — UI-only. The admin form pre-populates with this
// shape on first use (or after the row is deleted) so the admin has
// something to edit instead of a blank form that immediately fails
// the min(100) Zod check. This is NEVER used as a runtime fallback;
// lib/diagnostic/prompt-config.ts throws if no real prompt is seeded.
//
// Public on the repo — deliberately generic so no IP leaks. The real
// practitioner-voice prompt is admin-seeded per CONTRIBUTING.md.
export const DIAGNOSTIC_PROMPT_STARTER: DiagnosticPrompt = {
  systemPrompt:
    "Replace this with your real system prompt (minimum 100 characters). " +
    "Tell the model who it is, what voice to use, what JSON shape to emit, " +
    "and any forbidden words / tone constraints. " +
    "Expected output shape: " +
    `{"verdict": string, "narrative": string, "action_plan": [{"title": string, "explanation": string, "time_horizon": "immediate" | "30_days" | "90_days", "service_line": "ai_readiness_assessment" | "data_architecture" | "ai_agent_development"}]}. ` +
    "Respond ONLY with that JSON object — no prose before or after, no code fences.",
  version: "starter-v0",
};
