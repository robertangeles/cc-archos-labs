import { SignJWT, jwtVerify } from "jose";

// Edge-compatible JWT helpers. Used by middleware.ts (Edge runtime) and
// route handlers (Node runtime) alike — does not import next/headers.
// Cookie reading/writing for server components and route handlers lives
// in lib/auth-server.ts to keep this file safe to import from middleware.

export const SESSION_COOKIE = "archos_admin_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

export interface SessionPayload {
  admin: true;
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

export async function signSession(): Promise<string> {
  const secret = getAuthSecret();
  return new SignJWT({ admin: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret);
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const secret = getAuthSecret();
    const { payload } = await jwtVerify(token, secret);
    if (payload.admin !== true) return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// Constant-time string comparison so password validation doesn't leak
// length or content via timing differences.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function verifyAdminPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 8) {
    // Fail closed — never grant access if no password is configured.
    return false;
  }
  return timingSafeEqual(input, expected);
}
