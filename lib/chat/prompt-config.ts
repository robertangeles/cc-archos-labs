import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";
import {
  CHAT_PROMPT_STARTER,
  ChatPromptSchema,
  SITE_SETTING_KEY,
  type ChatPrompt,
} from "./prompt-config-shared";

export const getChatPrompt = cache(async (): Promise<ChatPrompt> => {
  let rows;
  try {
    const db = getDb();
    rows = await db
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, SITE_SETTING_KEY))
      .limit(1);
  } catch (err) {
    console.warn(
      "[chat-prompt] DB unreachable, falling back to starter:",
      err,
    );
    return CHAT_PROMPT_STARTER;
  }

  if (rows.length === 0) {
    return CHAT_PROMPT_STARTER;
  }

  const parsed = ChatPromptSchema.safeParse(rows[0].value);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((i) => i.path.join("."))
      .join(", ");
    console.warn(
      `[chat-prompt] Stored row failed validation (fields: ${fields}). ` +
        `Falling back to starter. Re-save in /admin/prompts.`,
    );
    return CHAT_PROMPT_STARTER;
  }

  return parsed.data;
});
