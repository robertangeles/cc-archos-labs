import "server-only";
import { assertReservedSlugsMatchFilesystem } from "./reserved-slugs-fs";

// Boot-time assertion that every top-level app/ directory is in
// RESERVED_SLUGS (or is a known CMS-managed slug). Imported by the
// catch-all route so the deploy fails fast if a future PR adds a static
// route without updating the set.
//
// The CMS-managed slug set is hardcoded to the seed-time pages
// (privacy, terms) — the seed migration creates these and the cutover
// deletes their static-route directories. If you add another CMS-
// managed slug later AND a static route with the same name exists for
// a transition window, add it here.
//
// Throws on mismatch — surfaces as a server error in dev (visible in
// logs + browser) and as a failed deploy in prod (Render's start-up
// check catches the unhandled exception).
//
// Idempotent. Calling more than once costs one readdirSync of app/.

const CMS_MANAGED_SLUGS = new Set(["privacy", "terms"]);

let didRun = false;
let lastError: Error | null = null;

export function runBootCheck(): void {
  if (didRun) {
    if (lastError) throw lastError;
    return;
  }
  didRun = true;
  try {
    assertReservedSlugsMatchFilesystem({ cmsSlugs: CMS_MANAGED_SLUGS });
  } catch (err) {
    lastError = err as Error;
    throw err;
  }
}
