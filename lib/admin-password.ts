import "server-only";
import { timingSafeEqual } from "./auth";

// Admin password verification — node-only.
//
// This file is the destination for verifyAdminPassword after the
// lib/auth.ts split. The split is structural now (this PR A); the
// behaviour is still env-rooted, matching today's production. PR B
// changes the body to read from getIntegrationConfig() once the DB-
// backed loader is verified and the migration has run.
//
// Why split now even though behaviour is unchanged: lib/auth.ts is
// imported by proxy.ts (Edge runtime). The future PR B implementation
// will pull in node:crypto + Postgres via getIntegrationConfig() —
// neither is Edge-safe. Doing the split here lets PR B be a one-file
// body change instead of a cross-cutting refactor.
//
// Callers: app/api/admin/login/route.ts only. Runs in nodejs runtime
// (verified in the route file's `export const runtime`).

/**
 * Compares the input against the configured admin password using
 * constant-time comparison so length and content don't leak through
 * timing. Returns true on match, false on mismatch or missing config.
 *
 * Currently reads from process.env.ADMIN_PASSWORD (PR A — inert change).
 * PR B switches the body to (await getIntegrationConfig()).adminPassword.
 * The async signature is permanent so PR B doesn't change call sites.
 */
export async function verifyAdminPassword(input: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 8) {
    // Fail closed — never grant access if no password is configured.
    return false;
  }
  return timingSafeEqual(input, expected);
}
