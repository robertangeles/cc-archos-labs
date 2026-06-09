import { z } from "zod/v4";

export const createConversationSchema = z.object({
  model: z.string().min(1).max(100),
  title: z.string().max(255).optional(),
  systemPrompt: z.string().max(2000).optional(),
});

export const updateConversationSchema = z.object({
  title: z.string().max(255).optional(),
  systemPrompt: z.string().max(2000).nullable().optional(),
  model: z.string().min(1).max(100).optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(32000),
  model: z.string().min(1).max(100).optional(),
  webSearch: z.boolean().optional(),
});
