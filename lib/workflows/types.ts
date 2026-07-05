export type WorkflowStatus = "draft" | "published" | "archived";

export type WorkflowFieldType =
  | "text"
  | "image"
  | "dropdown"
  | "multiline"
  | "document";

export type ApprovalMode = "auto" | "manual";

export interface WorkflowFieldDef {
  id: string;
  type: WorkflowFieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

export interface EditorConfig {
  enabled: boolean;
  model: string;
  systemPrompt: string;
  maxRounds: number;
  approvalMode: ApprovalMode;
}

export interface WorkflowStepDef {
  id: string;
  skillId?: string;
  skillVersion?: number;
  inputMappings?: Record<string, string>;
  overrides?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  };
  editor?: EditorConfig;
  provider: string;
  model: string;
  prompt: string;
  capabilities: string[];
  order: number;
}

export interface WorkflowConfig {
  fields: WorkflowFieldDef[];
  steps: WorkflowStepDef[];
  style?: string;
}

export interface StepResult {
  stepId: string;
  skillId: string;
  outputs: Record<string, string>;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  durationMs: number;
  status: "success" | "error";
  error?: string;
  estimatedCost?: number | null;

  // --- Regenerate provenance (set only on an amended step) ---
  // Marks a step whose output was replaced by a per-step Regenerate. Used for
  // measurability ("re-runs avoided", per-step regen rate) and to distinguish
  // an amended step from an original-run step in the same JSONB array. A JSONB
  // field, deliberately NOT the workflow_execution_log.editor_rounds column,
  // which belongs to the dormant editor loop.
  source?: "regenerate";
  // ISO timestamp of the amend. The run table has no updated_at, so this is the
  // record of when a step was last regenerated (drives an "edited" marker in
  // history, since listRuns still orders by created_at).
  regeneratedAt?: string;
  // The feedback text used for this regeneration, if any (control-char-stripped,
  // NOT injection-proof — it is appended to the step prompt).
  feedback?: string;
  // The prior output, stashed so a future undo can restore it without a
  // migration. No undo UI in v1.
  replacedOutput?: Record<string, string>;

  // --- Downstream staleness (E4) ---
  // True when this output was derived from an earlier step that has since been
  // regenerated, but this step was NOT re-run (rerunDownstream was off). The UI
  // dims it and offers "Rerun from here". No warning colour (single-accent rule).
  isStale?: boolean;
}

export interface SSEStepStart {
  stepIndex: number;
  skillName: string;
  model: string;
}

export interface SSEStepComplete {
  stepIndex: number;
  output: Record<string, string>;
  duration: number;
  tokens: { input: number; output: number };
  model: string;
  estimatedCost?: number | null;
}

export interface SSEStepError {
  stepIndex: number;
  error: string;
}

export interface SSEEditorRound {
  stepIndex: number;
  round: number;
  maxRounds: number;
  verdict: "approve" | "revise";
  feedback: string;
  revisedOutput?: string;
}

export interface SSEEditorApprovalNeeded {
  stepIndex: number;
  round: number;
  generatorOutput: string;
  editorFeedback: string;
}

export interface SSEDone {
  totalDuration: number;
  status: "completed" | "failed";
  totalEstimatedCost?: number | null;
}

export type SSEEvent =
  | { type: "step_start"; data: SSEStepStart }
  | { type: "step_complete"; data: SSEStepComplete }
  | { type: "step_error"; data: SSEStepError }
  | { type: "editor_round"; data: SSEEditorRound }
  | { type: "editor_approval_needed"; data: SSEEditorApprovalNeeded }
  | { type: "done"; data: SSEDone };
