import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";
import {
  DiagnosticContentSchema,
  type DiagnosticContent,
} from "./content-config-shared";

// Server-only loader for the diagnostic content row. cache() dedupes
// within a request. The source of truth is the site_setting row keyed
// 'diagnostic_content' (seeded by an admin via /admin/diagnostic).
//
// No code-level fallback. A missing or malformed content row throws a
// clear error pointing at the admin UI. Same treatment as the system
// prompt (PR #31) and model id (PR #30): silent fallbacks hide
// misconfiguration; loud failure forces the admin to seed the real
// practitioner-calibrated content.

export const SITE_SETTING_KEY = "diagnostic_content";

export const getDiagnosticContent = cache(
  async (): Promise<DiagnosticContent> => {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, SITE_SETTING_KEY))
      .limit(1);

    if (rows.length === 0) {
      throw new Error(
        "Diagnostic content not configured. Seed it in /admin/diagnostic before serving the assessment.",
      );
    }

    const parsed = DiagnosticContentSchema.safeParse(rows[0].value);
    if (!parsed.success) {
      const fields = parsed.error.issues
        .map((i) => i.path.join("."))
        .join(", ");
      throw new Error(
        `Stored diagnostic content failed validation (fields: ${fields}). Re-save it in /admin/diagnostic.`,
      );
    }
    return parsed.data;
  },
);
