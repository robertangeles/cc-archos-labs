import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";
import {
  DiagnosticPromptSchema,
  type DiagnosticPrompt,
} from "./prompt-config-shared";

// Server-only loader for the diagnostic system prompt. cache() dedupes
// within a request. The source of truth is the site_setting row keyed
// 'diagnostic_prompt' (seeded by an admin via /admin/prompts).
//
// No code-level fallback. A missing or malformed prompt row throws a
// clear error pointing at the admin UI. Same treatment as the LLM
// model id (PR #30): silent fallbacks hide misconfiguration; loud
// failure forces the admin to actually seed the prompt.

export const SITE_SETTING_KEY = "diagnostic_prompt";

export const getDiagnosticPrompt = cache(
  async (): Promise<DiagnosticPrompt> => {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, SITE_SETTING_KEY))
      .limit(1);

    if (rows.length === 0) {
      throw new Error(
        "Diagnostic prompt not configured. Seed it in /admin/prompts before generating any report.",
      );
    }

    const parsed = DiagnosticPromptSchema.safeParse(rows[0].value);
    if (!parsed.success) {
      const fields = parsed.error.issues
        .map((i) => i.path.join("."))
        .join(", ");
      throw new Error(
        `Stored diagnostic prompt failed validation (fields: ${fields}). Re-save it in /admin/prompts.`,
      );
    }
    return parsed.data;
  },
);
