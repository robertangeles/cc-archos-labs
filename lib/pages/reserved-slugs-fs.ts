// Filesystem-touching helpers for the reserved-slug guard. Split out
// from reserved-slugs.ts so the pure `isReservedSlug` (used by Zod
// validation in lib/pages/schema.ts, which is bundled into the client
// via the admin form) never pulls `node:fs` into the client bundle.
//
// Only the server-only catch-all + boot-check should import from here.

import "server-only";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_SLUGS } from "./reserved-slugs";

const APP_DIR = join(process.cwd(), "app");

/**
 * Lists top-level slugs that exist as static route directories under app/.
 * Excludes:
 *  - Files (e.g. app/page.tsx, app/layout.tsx, app/globals.css)
 *  - Internal directories starting with `_` (e.g. app/_components/)
 *  - Route groups in parens (e.g. app/(marketing)/)
 *  - Dynamic segments in brackets (e.g. app/[...slug]/) — this IS the
 *    catch-all, by definition not a reserved slug
 */
export function listAppTopLevelRoutes(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(APP_DIR);
  } catch {
    // app/ missing → return empty so the assertion is a no-op in
    // contexts where it doesn't apply (e.g. unit tests run from /tmp).
    return [];
  }
  return entries.filter((name) => {
    if (name.startsWith("_")) return false;
    if (name.startsWith("(") && name.endsWith(")")) return false;
    if (name.startsWith("[")) return false;
    try {
      return statSync(join(APP_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Asserts every top-level app/ directory is in RESERVED_SLUGS (or is a
 * known CMS-managed slug). Throws on mismatch — wire into the Next.js
 * bootstrap so a forgotten reserved slug fails the deploy fast.
 *
 * `opts.routes` overrides the filesystem read — used by unit tests to
 * exercise the function deterministically.
 */
export function assertReservedSlugsMatchFilesystem(
  opts: { routes?: string[]; cmsSlugs?: Set<string> } = {},
): void {
  const onDisk = opts.routes ?? listAppTopLevelRoutes();
  const cmsSlugs = opts.cmsSlugs ?? new Set<string>();

  const missing = onDisk.filter(
    (name) => !RESERVED_SLUGS.has(name) && !cmsSlugs.has(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `Pages CMS guard: top-level app/ route(s) not in RESERVED_SLUGS — ` +
        `[${missing.join(", ")}]. Add them to lib/pages/reserved-slugs.ts ` +
        `or the catch-all will shadow them.`,
    );
  }
  // Reverse direction: listed slugs that aren't on disk. Not fatal but
  // worth a warning (e.g. someone deleted a route and forgot to clean
  // up this list).
  const orphaned = [...RESERVED_SLUGS].filter((s) => !onDisk.includes(s));
  if (orphaned.length > 0 && process.env.NODE_ENV === "development") {
    console.warn(
      `[reserved-slugs] These slugs are in RESERVED_SLUGS but no ` +
        `matching app/ directory exists: [${orphaned.join(", ")}]. ` +
        `Safe — but consider pruning if the routes were removed.`,
    );
  }
}
