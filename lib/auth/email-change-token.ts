import { SignJWT, jwtVerify } from "jose";

// Email-change JWT. Carries the NEW email address so the click target
// can apply the change without re-prompting. Single-use enforced via
// users.token_version (same pattern as password-reset).
//
// Sent to the NEW email address — proves the user controls that
// inbox before we trust it. The OLD email never receives the
// confirmation link; if an attacker has hijacked the session and
// requests an email change to their own address, the legitimate owner
// at the OLD address never sees the link → the attacker still has to
// own the new inbox.
//
// 30-minute TTL. Slightly longer than password-reset because email
// providers sometimes delay delivery; still tight enough to limit
// risk if the link leaks.
//
// Purpose claim 'email-change' prevents cross-purpose use.

const EMAIL_CHANGE_TOKEN_TTL_SECONDS = 30 * 60;
const PURPOSE = "email-change" as const;

export interface EmailChangeTokenPayload {
  sub: string; // userId
  purpose: typeof PURPOSE;
  /** users.token_version at mint time. Single-use guard. */
  tv: number;
  /** The new email address the user wants to switch to. */
  ne: string;
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

export async function signEmailChangeToken(
  userId: string,
  tokenVersion: number,
  newEmail: string,
): Promise<string> {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("signEmailChangeToken: userId required");
  }
  if (typeof newEmail !== "string" || newEmail.length === 0) {
    throw new Error("signEmailChangeToken: newEmail required");
  }
  const secret = getAuthSecret();
  return new SignJWT({ purpose: PURPOSE, tv: tokenVersion, ne: newEmail })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${EMAIL_CHANGE_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyEmailChangeToken(
  token: string,
): Promise<EmailChangeTokenPayload | null> {
  if (typeof token !== "string" || token.length === 0) return null;
  try {
    const secret = getAuthSecret();
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== PURPOSE) return null;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    if (typeof payload.tv !== "number") return null;
    if (typeof payload.ne !== "string" || payload.ne.length === 0) {
      return null;
    }
    return payload as unknown as EmailChangeTokenPayload;
  } catch {
    return null;
  }
}
