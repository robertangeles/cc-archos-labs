import { SignJWT, jwtVerify } from "jose";

// JWT-based email-verification tokens. Edge-safe (no DB, no node:crypto).
//
// Why stateless JWT not the magic_link_token table:
//   - Setting users.email_verified_at is idempotent — clicking the link
//     twice is a no-op, so single-use enforcement doesn't add value.
//   - magic_link_token.lead_id FK is still pointing at the lead table
//     until Phase 5 renames things. Avoid coupling here.
//   - The link only grants the "this email is reachable" assertion.
//     It does NOT grant a session. The user still has to log in.
//
// Payload shape:
//   { sub: userId, purpose: 'verify-email' }
//
// TTL 24h — verification links sit in inboxes for a while.

const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const PURPOSE = "verify-email" as const;

export interface VerificationTokenPayload {
  sub: string; // userId
  purpose: typeof PURPOSE;
  iat?: number;
  exp?: number;
}

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is not set or too short (need at least 32 bytes).",
    );
  }
  return new TextEncoder().encode(secret);
}

/** Mint a verification token for a user. 24h TTL. */
export async function signVerificationToken(userId: string): Promise<string> {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("signVerificationToken: userId must be a non-empty string");
  }
  const secret = getAuthSecret();
  return new SignJWT({ purpose: PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${VERIFICATION_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

/**
 * Verify a token. Returns the userId on success, null on any failure
 * (bad signature, expired, wrong purpose, malformed). Never throws.
 */
export async function verifyVerificationToken(
  token: string,
): Promise<string | null> {
  if (typeof token !== "string" || token.length === 0) return null;
  try {
    const secret = getAuthSecret();
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== PURPOSE) return null;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    return payload.sub;
  } catch {
    return null;
  }
}
