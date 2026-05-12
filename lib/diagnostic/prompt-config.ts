import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";
import {
  DIAGNOSTIC_PROMPT_FALLBACK,
  DiagnosticPromptSchema,
  type DiagnosticPrompt,
} from "./prompt-config-shared";

// Server-only loader for the diagnostic system prompt. Mirrors the
// site-config pattern: cache() dedupes within a request, falls back
// to the generic source default on DB error or missing row.
//
// Admin seeds the real prompt via /admin/prompts on first deploy. The
// source default is deliberately weak so a missing seed produces an
// obviously-degraded report rather than silently leaking IP through
// some half-tuned default.

export const SITE_SETTING_KEY = "diagnostic_prompt";

export const getDiagnosticPrompt = cache(async (): Promise<DiagnosticPrompt> => {
  try {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, SITE_SETTING_KEY))
      .limit(1);

    if (rows.length === 0) {
      return DIAGNOSTIC_PROMPT_FALLBACK;
    }

    const parsed = DiagnosticPromptSchema.safeParse(rows[0].value);
    return parsed.success ? parsed.data : DIAGNOSTIC_PROMPT_FALLBACK;
  } catch (err) {
    console.error(
      "getDiagnosticPrompt failed, falling back to source default:",
      err,
    );
    return DIAGNOSTIC_PROMPT_FALLBACK;
  }
});
