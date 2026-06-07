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
