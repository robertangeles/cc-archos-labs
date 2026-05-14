import "server-only";
import { SignJWT, jwtVerify } from "jose";

// Short-lived JWT issued after an admin re-confirms their password,
// authorizing one-shot plaintext reveals of integration secrets.
//
// Why a separate token instead of "always show plaintext to a signed-in
// admin": the admin session JWT lives for 24 hours. An unlocked laptop
// with /admin already open shouldn't grant a passerby read access to
// every secret. The reveal token forces a fresh password proof for
// each reveal burst (5-minute window).
//
// Signed with the same AUTH_SECRET as the admin session JWT — one less
// secret to manage. Claims pin the token to a specific admin session
// (sessionFingerprint) so a token issued for one signed-in admin can't
// be replayed by another.

const REVEAL_TOKEN_TTL_SECONDS = 60 * 5; // 5 minutes

export const REVEAL_COOKIE = "archos_admin_reveal";

export interface RevealTokenPayload {
  reveal: true;
  /** Hash of the admin session JWT, ties this reveal to one session. */
  sessionFingerprint: string;
  iat?: number;
  exp?: number;
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is not set or too short (need at least 32 bytes).",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Issue a fresh reveal token. Caller must have already verified the
 * admin's password via verifyAdminPassword. sessionFingerprint should
 * be a stable hash of the admin session JWT so the reveal token is
 * tied to a specific session.
 */
export async function signRevealToken(
  sessionFingerprint: string,
): Promise<string> {
  return new SignJWT({ reveal: true, sessionFingerprint })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${REVEAL_TOKEN_TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Verify a reveal token. Returns the payload if the token is valid,
 * not expired, AND its sessionFingerprint matches the caller's current
 * admin session. Returns null otherwise. Never throws — failure is
 * always 401 to the caller.
 */
export async function verifyRevealToken(
  token: string,
  expectedFingerprint: string,
): Promise<RevealTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.reveal !== true) return null;
    if (payload.sessionFingerprint !== expectedFingerprint) return null;
    return payload as unknown as RevealTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Stable fingerprint for an admin session JWT. We hash the raw token
 * so the reveal token doesn't need the full session JWT in its claims
 * (which would make the cookie large). Crypto-strength hash means
 * collisions are not a concern.
 */
export async function fingerprintSession(adminSessionJwt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(adminSessionJwt);
  const hash = await crypto.subtle.digest("SHA-256", data);
  // Base64url the first 16 bytes — short enough to fit in a JWT claim
  // without bloat, long enough that collisions are unrealistic.
  const bytes = new Uint8Array(hash).slice(0, 16);
  return Buffer.from(bytes).toString("base64url");
}
