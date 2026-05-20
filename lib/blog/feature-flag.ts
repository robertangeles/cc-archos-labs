import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { siteSetting } from "../db/schema";

// Feature flag for the public /blog surface. Mirrors lib/pages/feature-flag.ts
// but defaults to FALSE — the blog ships dark by default so the migration
// (PR #62) can land on prod with the rendered routes returning 404 until
// the Phase C cutover. Flip the flag from /admin/site (blog toggle section)
// or via SQL:
//   INSERT INTO site_setting (key, value) VALUES ('blog_enabled', '{"enabled": true}')
//   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
//
// Cache TTL: none until explicit invalidation. Render runs a single
// container — module state persists for the lifetime of the process.
// Multi-instance needs pub/sub; not in scope here.

const FLAG_KEY = "blog_enabled";

// Default if the row is absent. FALSE = /blog returns notFound() until
// the operator opts in.
const DEFAULT_VALUE = false;

let cachedPromise: Promise<boolean> | null = null;

export async function isBlogEnabled(): Promise<boolean> {
  if (cachedPromise) return cachedPromise;

  cachedPromise = loadFlag().catch((err) => {
    // On error, clear cache so the next call retries — fail CLOSED
    // (return false) so a transient DB blip doesn't accidentally expose
    // unfinished blog routes. Pages CMS fails open because the legal
    // pages are pre-existing live content; the blog has no legacy
    // surface so closed is the safe default.
    cachedPromise = null;
    console.error("[blog-feature-flag] load failed, defaulting to false:", err);
    throw err;
  });

  return cachedPromise.catch(() => DEFAULT_VALUE);
}

export function clearBlogEnabledCache(): void {
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
    return DEFAULT_VALUE;
  }

  const stored = rows[0].value as Record<string, unknown>;
  if (typeof stored.enabled === "boolean") {
    return stored.enabled;
  }
  console.warn(
    `[blog-feature-flag] site_setting row '${FLAG_KEY}' has unexpected ` +
      `shape: ${JSON.stringify(stored)}. Falling back to default=${DEFAULT_VALUE}.`,
  );
  return DEFAULT_VALUE;
}
