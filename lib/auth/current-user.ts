import "server-only";
import { getSessionJwtFromCookies } from "./cookies";
import { loadActiveSession, type LoadedSession } from "./session";

// Read the session cookie, verify its JWT, and load the live user +
// session row. Single entry point for "who is the request from?" in
// authenticated route handlers.
//
// Returns null if any layer fails:
//   1. No cookie present
//   2. JWT signature / expiry / payload shape invalid
//   3. session row missing
//   4. session.revoked_at set
//   5. session expired
//   6. users.is_active = false
//   7. tokenVersion mismatch (revokeAllSessionsForUser was called)
//
// Callers MUST treat null as unauthenticated regardless of cause —
// don't leak which check failed to the response body.

export async function getCurrentUser(): Promise<LoadedSession | null> {
  const jwt = await getSessionJwtFromCookies();
  if (!jwt) return null;
  return loadActiveSession(jwt.sessionId, jwt.tokenVersion);
}
