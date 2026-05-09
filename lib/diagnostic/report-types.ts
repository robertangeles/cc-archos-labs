// Claude report output shape per spec §6 + §9. The system prompt
// constrains Claude to produce this exactly. Stored as JSONB in
// report_output.action_plan; verdict + narrative are text columns.

export type ActionTimeHorizon = "immediate" | "30_days" | "90_days";

export const ACTION_TIME_HORIZON_LABELS: Record<ActionTimeHorizon, string> = {
  immediate: "Immediate",
  "30_days": "30 days",
  "90_days": "90 days",
};

// Maps to an Archos Labs offering — the report CTA + admin lead routing
// use this to connect risk to remediation.
export type ActionServiceLine =
  | "ai_readiness_assessment"
  | "data_architecture"
  | "ai_agent_development";

export const SERVICE_LINE_LABELS: Record<ActionServiceLine, string> = {
  ai_readiness_assessment: "AI Readiness Assessment",
  data_architecture: "Data Architecture",
  ai_agent_development: "AI Agent Development",
};

export interface ActionItem {
  // One-line, verb-led title.
  title: string;
  // Two sentences explaining the action.
  explanation: string;
  time_horizon: ActionTimeHorizon;
  service_line: ActionServiceLine;
}

// Full report content as Claude returns it. Stored split across two
// text columns + one JSONB column on report_output.
export interface ReportContent {
  // Single-sentence verdict, max 25 words. Used in the report header
  // and the email subject line.
  verdict: string;
  // 400–500 word practitioner narrative across 2–3 paragraphs.
  // Flowing prose only; no bullets, no subheadings.
  narrative: string;
  // 3–5 sequenced actions.
  action_plan: ActionItem[];
}

// Validates the shape of a parsed Claude response. Returns the typed
// value or null if the shape is wrong. Cheaper than a full Zod parse;
// used in the hot path where a malformed response is rare and we want
// a fast fail-soft.
export function isValidReportContent(value: unknown): value is ReportContent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.verdict !== "string" || v.verdict.length === 0) return false;
  if (typeof v.narrative !== "string" || v.narrative.length === 0)
    return false;
  if (!Array.isArray(v.action_plan)) return false;
  for (const a of v.action_plan) {
    if (typeof a !== "object" || a === null) return false;
    const action = a as Record<string, unknown>;
    if (typeof action.title !== "string") return false;
    if (typeof action.explanation !== "string") return false;
    if (
      action.time_horizon !== "immediate" &&
      action.time_horizon !== "30_days" &&
      action.time_horizon !== "90_days"
    )
      return false;
    if (
      action.service_line !== "ai_readiness_assessment" &&
      action.service_line !== "data_architecture" &&
      action.service_line !== "ai_agent_development"
    )
      return false;
  }
  return true;
}
