import { z } from "zod";

export const createRuleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  category: z.string().trim().min(1, "Category is required").max(100),
  content: z.string().trim().min(1, "Rule content is required").max(10000),
  isEnabled: z.boolean().optional().default(true),
});

export const updateRuleSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  content: z.string().trim().min(1).max(10000).optional(),
  isEnabled: z.boolean().optional(),
});

export const toggleRuleSchema = z.object({
  isEnabled: z.boolean(),
});

export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
