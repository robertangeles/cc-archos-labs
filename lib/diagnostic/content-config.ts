import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";
import {
  DIAGNOSTIC_CONTENT_FALLBACK,
  DiagnosticContentSchema,
  type DiagnosticContent,
} from "./content-config-shared";

// Server-only loader for the diagnostic content row. Mirrors the
// prompt-config pattern from D-26: cache() dedupes within a request,
// falls back to the source default on DB error or missing row.
//
// The admin seeds the real content via /admin/diagnostic on first
// deploy. The source default is intentionally placeholder so a missing
// seed produces an obviously-degraded assessment rather than silently
// shipping wrong content.

export const SITE_SETTING_KEY = "diagnostic_content";

export const getDiagnosticContent = cache(
  async (): Promise<DiagnosticContent> => {
    try {
      const db = getDb();
      const rows = await db
        .select({ value: siteSetting.value })
        .from(siteSetting)
        .where(eq(siteSetting.key, SITE_SETTING_KEY))
        .limit(1);

      if (rows.length === 0) {
        return DIAGNOSTIC_CONTENT_FALLBACK;
      }

      const parsed = DiagnosticContentSchema.safeParse(rows[0].value);
      return parsed.success ? parsed.data : DIAGNOSTIC_CONTENT_FALLBACK;
    } catch (err) {
      console.error(
        "getDiagnosticContent failed, falling back to source default:",
        err,
      );
      return DIAGNOSTIC_CONTENT_FALLBACK;
    }
  },
);
