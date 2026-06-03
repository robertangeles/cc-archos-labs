import "server-only";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  verifySessionJwt,
  verifySessionJwtIgnoreExpiry,
  type SessionJwtPayload,
} from "./session-jwt";

// Cookie helpers for the unified session cookie (archos_session).
// Server-only — uses next/headers.
//
// proxy.ts (Edge) reads the same cookie via request.cookies.get() and
// calls verifySessionJwt directly; it does NOT import this file.
// Route handlers read/write via these helpers.

// 7 days. Matches user_session.expires_at hard limit. The JWT inside
// the cookie has a 5-min TTL of its own; we rotate JWTs via
// refreshSession() and update the cookie. The browser-level cookie
// expiry is the hard ceiling.
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export async function setSessionCookie(jwtValue: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, jwtValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Read the session cookie + verify its JWT signature/exp/payload shape.
 * Returns the decoded payload or null. Does NOT load the user_session
 * row from the DB — callers needing the full liveness check must call
 * `loadActiveSession(payload.sessionId, payload.tokenVersion)` from
 * lib/auth/session.ts.
 */
export async function getSessionJwtFromCookies(): Promise<SessionJwtPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const valid = await verifySessionJwt(token);
  if (valid) return valid;
  return verifySessionJwtIgnoreExpiry(token);
}
