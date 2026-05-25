import { SignJWT, jwtVerify } from "jose";

// Edge-compatible JWT sign + verify for the unified session cookie.
// Used by proxy.ts (Edge runtime) and route handlers (Node runtime).
// Does NOT import next/headers, postgres, drizzle, or any node:* —
// must remain Edge-safe.
//
// Payload shape carries enough information for the Edge gate to:
//   1. Verify the signature (rejects forged tokens)
//   2. Check expiry (`exp`)
//   3. Compare tokenVersion against users.token_version (rejects
//      revoked-via-bump tokens — but this comparison requires a
//      DB read so it happens in route handlers, not the Edge gate)
//
// Revocation latency = remaining JWT TTL. The 5-minute TTL caps
// damage from a stolen token AND keeps the sliding-refresh load
// modest (~1 mint per active user every 5 min).
//
// Cookie name is shared with the admin-only legacy auth — same cookie
// path, but the payload shape distinguishes new vs legacy. The legacy
// shim in lib/auth/legacy-lead-session.ts (Phase 5) handles the
// `{ leadId }` payload separately and exchanges it for the new shape.

export const SESSION_COOKIE = "archos_session";

// 5 minutes. Sliding refresh on activity bumps user_session.last_seen_at
// and mints a fresh JWT. Revocation latency = remaining lifetime.
export const SESSION_JWT_TTL_SECONDS = 5 * 60;

export interface SessionJwtPayload {
  /** FK to users.id */
  userId: string;
  /** FK to user_session.id */
  sessionId: string;
  /** Copy of users.token_version at mint time. Bumped on password
   * reset / admin force-logout; mismatch rejects without DB lookup. */
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is not set or too short (need at least 32 bytes). " +
        "Generate with: openssl rand -base64 32 — then add to .env.local " +
        "and to the Render service env vars in production.",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mint a session JWT carrying the canonical payload shape. Called by
 * `lib/auth/session.ts::issueSession()` and `refreshSession()` whenever
 * we need a fresh cookie value.
 */
export async function signSessionJwt(
  payload: Omit<SessionJwtPayload, "iat" | "exp">,
): Promise<string> {
  const secret = getAuthSecret();
  return new SignJWT({
    userId: payload.userId,
    sessionId: payload.sessionId,
    tokenVersion: payload.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_JWT_TTL_SECONDS}s`)
    .sign(secret);
}

/**
 * Verify a session JWT's signature + expiry + payload shape. Edge-safe.
 * Returns the decoded payload or `null` on any failure (bad signature,
 * expired, malformed payload). Does NOT check user_session.revoked_at
 * or users.is_active — those require a DB read; route handlers call
 * `loadActiveSession(sessionId)` to complete the revocation check.
 *
 * Callers in proxy.ts: trust the signature + expiry to allow the
 * request through to the matched handler, which performs the full
 * live-revocation check before serving any privileged data.
 */
export async function verifySessionJwt(
  token: string,
): Promise<SessionJwtPayload | null> {
  if (typeof token !== "string" || token.length === 0) return null;
  try {
    const secret = getAuthSecret();
    const { payload } = await jwtVerify(token, secret);
    if (
      typeof payload.userId !== "string" ||
      payload.userId.length === 0 ||
      typeof payload.sessionId !== "string" ||
      payload.sessionId.length === 0 ||
      typeof payload.tokenVersion !== "number"
    ) {
      return null;
    }
    return payload as unknown as SessionJwtPayload;
  } catch {
    return null;
  }
}
