import { z } from "zod";

export const SITE_SETTING_KEY = "workspace_chat_prompt";

export const ChatPromptSchema = z.object({
  systemPrompt: z
    .string()
    .trim()
    .min(50, "System prompt is too short to be useful")
    .max(20000, "System prompt is too long (max 20k chars)"),
  version: z
    .string()
    .trim()
    .min(1, "Version label required")
    .max(40, "Version label too long"),
});

export type ChatPrompt = z.infer<typeof ChatPromptSchema>;

export const CHAT_PROMPT_STARTER: ChatPrompt = {
  systemPrompt:
    "Replace this with your real workspace chat system prompt (minimum 50 characters). " +
    "Tell the model who it is, what tone to use, what guardrails to follow, " +
    "and any domain-specific context for your consulting practice.",
  version: "starter-v0",
};
