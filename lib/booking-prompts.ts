import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { siteSetting } from "./db/schema";
import {
  BOOKING_PROMPTS_STARTER,
  BookingPromptsSchema,
  SITE_SETTING_KEY,
  type BookingPrompts,
} from "./booking-prompts-shared";

// Server-only loader for the three booking-system Claude prompts.
// cache() dedupes within a request. Reads the site_setting row keyed
// 'booking_prompts'; falls back to BOOKING_PROMPTS_STARTER if the row
// is missing or malformed.
//
// Soft-fallback semantics (deliberately different from the diagnostic
// prompt, which fails loudly):
//   - DB row missing → fallback to hardcoded starter. Booking flow
//     keeps working with v1-quality prompts.
//   - DB row malformed → log a warning, fallback. Same reasoning.
//   - DB unreachable → log + fallback. Booking is operational —
//     losing AI augmentation is a degradation, not an outage.
//
// The hardcoded starter is the floor of quality, not a placeholder.
// Admin tuning at /admin/prompts is an improvement over the floor,
// not a prerequisite for the system to work.

export const getBookingPrompts = cache(async (): Promise<BookingPrompts> => {
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
      "[booking-prompts] DB unreachable, falling back to hardcoded starter:",
      err,
    );
    return BOOKING_PROMPTS_STARTER;
  }

  if (rows.length === 0) {
    // No admin-seeded row yet. Hardcoded starter is the runtime value.
    return BOOKING_PROMPTS_STARTER;
  }

  const parsed = BookingPromptsSchema.safeParse(rows[0].value);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((i) => i.path.join("."))
      .join(", ");
    console.warn(
      `[booking-prompts] Stored row failed validation (fields: ${fields}). ` +
        `Falling back to hardcoded starter. Re-save the prompts in /admin/prompts.`,
    );
    return BOOKING_PROMPTS_STARTER;
  }

  return parsed.data;
});
