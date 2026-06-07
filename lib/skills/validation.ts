import { z } from "zod";
import { SKILL_CATEGORIES } from "./types";

const skillInputSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, "Key must be lowercase alphanumeric with underscores"),
  type: z.enum(["text", "multiline", "select"]),
  label: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  required: z.boolean(),
  defaultValue: z.string().max(500).optional(),
  options: z.array(z.string().max(200)).max(50).optional(),
});

const skillOutputSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, "Key must be lowercase alphanumeric with underscores"),
  type: z.enum(["text", "markdown", "json"]),
  label: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
});

export const createSkillSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  description: z.string().trim().min(1, "Description is required").max(5000),
  category: z.enum(SKILL_CATEGORIES as [string, ...string[]]),
  promptTemplate: z.string().min(1, "Prompt template is required").max(50000),
  systemPrompt: z.string().max(10000).optional(),
  defaultModel: z.string().min(1).max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  inputs: z.array(skillInputSchema).max(20).optional(),
  outputs: z.array(skillOutputSchema).max(10).optional(),
});

export const updateSkillSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  category: z.enum(SKILL_CATEGORIES as [string, ...string[]]).optional(),
  promptTemplate: z.string().min(1).max(50000).optional(),
  systemPrompt: z.string().max(10000).nullable().optional(),
  defaultModel: z.string().min(1).max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  inputs: z.array(skillInputSchema).max(20).optional(),
  outputs: z.array(skillOutputSchema).max(10).optional(),
  changelog: z.string().max(500).optional(),
});

export const executeSkillSchema = z.object({
  inputs: z.record(z.string(), z.string().max(50000)),
  model: z.string().min(1).max(100).optional(),
});

export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
export type ExecuteSkillInput = z.infer<typeof executeSkillSchema>;
