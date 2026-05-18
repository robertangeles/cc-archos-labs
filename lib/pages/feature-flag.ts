import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";

// Module-level cache for the `pages_cms_enabled` feature flag. Mirrors
// the pattern in lib/integration-config.ts — promise-based so concurrent
// first-call requests share one DB read, with explicit invalidation
// called by the admin save endpoint.
//
// Why a feature flag at all:
//   - Phase 1 cutover is irreversible at the route level (we delete
//     app/privacy/page.tsx in the same commit as the catch-all).
//     If the catch-all crashes in prod, the flag = false response is a
//     graceful 404 ("page does not exist") rather than a 500.
//   - Manual flip via `/admin/site` lets us hot-disable the entire CMS
//     surface without a redeploy.
//
// Cache TTL: none (until explicit invalidation). Render runs a single
// container per service — module state persists for the lifetime of the
// process. Multi-instance would need pub/sub; flagged as a Phase 4
// concern in wiki/decisions/2026-05-18-pages-cms-expansion.md.

const FLAG_KEY = "pages_cms_enabled";

// Default if the row is absent. TRUE means the catch-all serves; FALSE
// means the catch-all returns notFound() unconditionally.
const DEFAULT_VALUE = true;

let cachedPromise: Promise<boolean> | null = null;

export async function isPagesCmsEnabled(): Promise<boolean> {
  if (cachedPromise) return cachedPromise;

  cachedPromise = loadFlag().catch((err) => {
    // On error, clear so next call retries — and log loudly. Fail-open
    // (return DEFAULT_VALUE=true) so a transient DB blip doesn't 404
    // the live legal pages. The error is logged so observability still
    // catches the regression.
    cachedPromise = null;
    console.error("[pages-feature-flag] load failed, defaulting to true:", err);
    throw err;
  });

  return cachedPromise.catch(() => DEFAULT_VALUE);
}

/**
 * Invalidate the in-process cache. Called by the admin save endpoint
 * after writing the flag. Tests call this between assertions.
 */
export function clearPagesCmsEnabledCache(): void {
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
    // No row → use default. Don't write the row here — admin writes
    // are explicit.
    return DEFAULT_VALUE;
  }

  const stored = rows[0].value as Record<string, unknown>;
  // The siteSetting.value column is jsonb. Persist as { enabled: bool }
  // so future fields can land in the same row without schema change.
  if (typeof stored.enabled === "boolean") {
    return stored.enabled;
  }
  // Shape drift → fail-open + warn so it's visible but doesn't break
  // public legal pages.
  console.warn(
    `[pages-feature-flag] site_setting row '${FLAG_KEY}' has unexpected ` +
      `shape: ${JSON.stringify(stored)}. Falling back to default=${DEFAULT_VALUE}.`,
  );
  return DEFAULT_VALUE;
}
