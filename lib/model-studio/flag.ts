import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";

// ============================================================================
// Model Studio feature flag (LIST VIEW ONLY).
//
// Migrated from Spresso (packages/server/src/services/model-studio.service.ts,
// getFlagEnabled / setFlagEnabled). Spresso stored the flag in a dedicated
// `settings` key/value table; this repo already has the equivalent
// `site_setting` JSONB key/value table, so we reuse it (no new migration) and
// mirror the established feature-flag pattern in lib/pages/feature-flag.ts:
// a module-level promise cache with explicit invalidation on write.
//
// Default is FALSE (matching Spresso's "false if row missing"): until an admin
// flips it on, the Model Studio page renders the "Coming soon" stub.
// ============================================================================

const FLAG_KEY = "model_studio";

// Default if the row is absent: feature OFF.
const DEFAULT_VALUE = false;

let cachedPromise: Promise<boolean> | null = null;

/** Read the flag. Returns DEFAULT_VALUE (false) on error or when unset. */
export async function isModelStudioEnabled(): Promise<boolean> {
  if (cachedPromise) return cachedPromise;

  cachedPromise = loadFlag().catch((err) => {
    // On error, clear so the next call retries, log loudly, and fall back to
    // the default (OFF) so a transient DB blip never accidentally exposes the
    // feature.
    cachedPromise = null;
    console.error("[model-studio-flag] load failed, defaulting to false:", err);
    throw err;
  });

  return cachedPromise.catch(() => DEFAULT_VALUE);
}

/**
 * Upsert the flag and return the stored value. Admin-gated at the route layer.
 * Clears the in-process cache so the next read reflects the new value.
 */
export async function setModelStudioEnabled(enabled: boolean): Promise<boolean> {
  const db = getDb();
  await db
    .insert(siteSetting)
    .values({ key: FLAG_KEY, value: { enabled } })
    .onConflictDoUpdate({
      target: siteSetting.key,
      set: { value: { enabled }, updatedAt: new Date() },
    });
  clearModelStudioFlagCache();
  return enabled;
}

/**
 * Invalidate the in-process cache. Called by setModelStudioEnabled after a
 * write; tests call it between assertions.
 */
export function clearModelStudioFlagCache(): void {
  cachedPromise = null;
}

async function loadFlag(): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, FLAG_KEY))
    .limit(1);

  if (rows.length === 0) {
    // No row → use default. Don't write the row here; admin writes are explicit.
    return DEFAULT_VALUE;
  }

  // The value column is jsonb. Persist as { enabled: bool } so future fields can
  // land in the same row without a schema change.
  const stored = rows[0].value as Record<string, unknown>;
  if (typeof stored.enabled === "boolean") {
    return stored.enabled;
  }
  // Shape drift → fall back to default + warn so it's visible but harmless.
  console.warn(
    `[model-studio-flag] site_setting row '${FLAG_KEY}' has unexpected ` +
      `shape: ${JSON.stringify(stored)}. Falling back to default=${DEFAULT_VALUE}.`,
  );
  return DEFAULT_VALUE;
}
