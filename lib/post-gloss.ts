import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { siteSetting } from "./db/schema";
import {
  PostGlossPromptsSchema,
  POST_GLOSS_STARTER,
  SITE_SETTING_KEY,
  type PostGlossPrompts,
} from "./post-gloss-shared";

// Server-only loader for the post-gloss Claude prompt. cache() dedupes
// within a request. Reads the site_setting row keyed 'post_gloss';
// falls back to POST_GLOSS_STARTER when the row is missing or
// malformed.
//
// Soft-fallback semantics mirror lib/booking-prompts.ts:
//   - DB row missing  → fallback to hardcoded starter
//   - DB row malformed → log + fallback
//   - DB unreachable  → log + fallback
//
// The hardcoded starter is the floor of quality, not a placeholder.
// Admin tuning at /admin/prompts/post-gloss improves the floor; the
// system works at v1 quality without admin involvement.

export const getPostGlossPrompts = cache(
  async (): Promise<PostGlossPrompts> => {
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
        "[post-gloss] DB unreachable, falling back to hardcoded starter:",
        err,
      );
      return POST_GLOSS_STARTER;
    }

    if (rows.length === 0) {
      // No admin-seeded row yet. Hardcoded starter is the runtime value.
      return POST_GLOSS_STARTER;
    }

    const parsed = PostGlossPromptsSchema.safeParse(rows[0].value);
    if (!parsed.success) {
      const fields = parsed.error.issues
        .map((i) => i.path.join("."))
        .join(", ");
      console.warn(
        `[post-gloss] Stored row failed validation (fields: ${fields}). ` +
          `Falling back to hardcoded starter. Re-save the prompt in /admin/prompts/post-gloss.`,
      );
      return POST_GLOSS_STARTER;
    }

    return parsed.data;
  },
);
