import "server-only";
import { timingSafeEqual } from "./auth";
import { getIntegrationConfig } from "./integration-config";

// Admin password verification — node-only.
//
// Lives in its own file because lib/auth.ts is imported by proxy.ts
// (Edge runtime), and Edge cannot do DB I/O. getIntegrationConfig()
// pulls in Postgres + node:crypto via lib/booking-crypto.ts, neither
// of which is Edge-safe. Splitting the password check off keeps
// lib/auth.ts safe to import from middleware.
//
// Callers: app/api/admin/login/route.ts only. Runs in nodejs runtime.

/**
 * Compares the input against the configured admin password using
 * constant-time comparison so length and content don't leak through
 * timing. Returns true on match, false on mismatch or missing config.
 *
 * Reads from the DB-backed integration_secrets row via
 * getIntegrationConfig(). During the 7-day grace window
 * (INTEGRATION_FALLBACK_ENABLED=true) the loader falls back to
 * process.env.ADMIN_PASSWORD if the DB row is empty — keeping admin
 * sign-in working during the cutover.
 *
 * Fails closed on any error from the loader: a DB outage or wrong
 * master key locks out the legitimate admin briefly rather than
 * granting access. The real failure mode (DB down, decrypt failed,
 * etc.) lands in the logs for the admin to investigate via Render's
 * log viewer.
 */
export async function verifyAdminPassword(input: string): Promise<boolean> {
  let expected: string;
  try {
    const config = await getIntegrationConfig();
    expected = config.adminPassword;
  } catch (err) {
    console.error("verifyAdminPassword: getIntegrationConfig failed:", err);
    return false;
  }

  if (!expected || expected.length < 8) {
    // Defensive: schema enforces min(8), but if a future migration
    // ever lands with an empty string we don't want to grant access.
    return false;
  }
  return timingSafeEqual(input, expected);
}
