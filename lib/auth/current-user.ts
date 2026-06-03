import "server-only";
import { getSessionJwtFromCookies } from "./cookies";
import { loadActiveSession, type LoadedSession } from "./session";

export async function getCurrentUser(): Promise<LoadedSession | null> {
  const jwt = await getSessionJwtFromCookies();
  if (!jwt) return null;
  return loadActiveSession(jwt.sessionId, jwt.tokenVersion);
}
