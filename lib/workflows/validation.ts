import { z } from "zod";

const workflowFieldSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["text", "image", "dropdown", "multiline", "document"]),
  label: z.string().min(1).max(255),
  placeholder: z.string().max(500).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().max(200)).max(50).optional(),
});

const editorConfigSchema = z.object({
  enabled: z.boolean(),
  model: z.string().max(100),
  systemPrompt: z.string().max(10000),
  maxRounds: z.number().int().min(1).max(10),
  approvalMode: z.enum(["auto", "manual"]),
});

const workflowStepSchema = z.object({
  id: z.string().min(1).max(100),
  skillId: z.string().uuid().optional(),
  skillVersion: z.number().int().optional(),
  inputMappings: z.record(z.string(), z.string().max(200)).optional(),
  overrides: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(1).max(32000).optional(),
      systemPrompt: z.string().max(10000).optional(),
    })
    .optional(),
  editor: editorConfigSchema.optional(),
  provider: z.string().max(50).default(""),
  model: z.string().max(100).default(""),
  prompt: z.string().max(50000).default(""),
  capabilities: z.union([
    z.array(z.string().max(50)).max(10),
    z.record(z.string(), z.unknown()).transform(() => [] as string[]),
  ]).default([]),
  order: z.number().int().min(0),
});

const workflowConfigSchema = z.object({
  fields: z.array(workflowFieldSchema).max(30).optional(),
  steps: z.array(workflowStepSchema).max(20).optional(),
  style: z.string().max(50).optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  description: z.string().trim().max(5000).optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  config: workflowConfigSchema.optional(),
});

export const executeWorkflowSchema = z.object({
  inputs: z.record(z.string(), z.string().max(50000)),
});

export const approveStepSchema = z.object({
  stepIndex: z.number().int().min(0),
  action: z.enum(["approve", "revise", "edit"]),
  feedback: z.string().max(10000).optional(),
});

// Per-step Regenerate. The client supplies ONLY intent — never execution
// context. The server rebuilds context from the run's own snapshot. feedback is
// appended to the step prompt (control-char-stripped, not injection-proof).
// rerunDownstream re-runs every step from the target onward so the deliverable
// stays coherent. overrideModel is an optional one-off model for this run only,
// distinct from the step's persisted model.
// Strip ASCII control characters before the string reaches the model API.
// Matches the pattern in lib/image-gen/service.ts. Not injection-proof, but
// prevents malformed byte sequences from corrupting the system prompt.
function stripControlChars(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export const regenerateStepSchema = z.object({
  feedback: z
    .string()
    .max(10000)
    .transform(stripControlChars)
    .optional(),
  rerunDownstream: z.boolean().default(false),
  overrideModel: z.string().max(100).optional(),
});

// E1 "make permanent": append this feedback to the step's persisted prompt.
// Non-empty (there is nothing to make permanent otherwise) and stripped.
export const appendStepPromptSchema = z.object({
  feedback: z
    .string()
    .min(1, "Feedback is required")
    .max(10000)
    .transform(stripControlChars),
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type ExecuteWorkflowInput = z.infer<typeof executeWorkflowSchema>;
export type ApproveStepInput = z.infer<typeof approveStepSchema>;
export type RegenerateStepInput = z.infer<typeof regenerateStepSchema>;
