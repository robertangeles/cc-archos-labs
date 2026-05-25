import { SignJWT, jwtVerify } from "jose";

// Password-reset JWT. Single-use enforced via users.token_version:
//   - Mint:    capture current users.token_version → embed as tv
//   - Verify:  caller loads user.token_version and compares against tv
//   - Consume: after applying the reset, caller bumps token_version
//              (via revokeAllSessionsForUser). The same token now
//              mismatches and replays fail.
//
// 15-minute TTL. Short window because the link grants password-change
// capability — limit the time window an interceptor can exploit a
// leaked token from a victim's inbox.
//
// Purpose claim 'password-reset' prevents cross-purpose use (a
// verify-email token can't be substituted into the reset endpoint).

const PASSWORD_RESET_TOKEN_TTL_SECONDS = 15 * 60;
const PURPOSE = "password-reset" as const;

export interface PasswordResetTokenPayload {
  sub: string; // userId
  purpose: typeof PURPOSE;
  /** users.token_version at mint time. Single-use guard. */
  tv: number;
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

/** Mint a reset token. Caller passes the current users.token_version. */
export async function signPasswordResetToken(
  userId: string,
  tokenVersion: number,
): Promise<string> {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("signPasswordResetToken: userId required");
  }
  const secret = getAuthSecret();
  return new SignJWT({ purpose: PURPOSE, tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${PASSWORD_RESET_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

/**
 * Verify signature + expiry + purpose + payload shape. Returns the
 * decoded payload or null on any failure. Caller is responsible for
 * the single-use check (compare payload.tv against live
 * users.token_version after loading the user).
 */
export async function verifyPasswordResetToken(
  token: string,
): Promise<PasswordResetTokenPayload | null> {
  if (typeof token !== "string" || token.length === 0) return null;
  try {
    const secret = getAuthSecret();
    const { payload } = await jwtVerify(token, secret);
    if (payload.purpose !== PURPOSE) return null;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    if (typeof payload.tv !== "number") return null;
    return payload as unknown as PasswordResetTokenPayload;
  } catch {
    return null;
  }
}
