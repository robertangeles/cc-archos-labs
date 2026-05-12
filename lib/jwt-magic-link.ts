// JWT magic-link helpers for self-serve cancel + reschedule (D3c).
//
// The token carries:
//   - bid:  booking_request.id this link acts on
//   - kind: "cancel" | "reschedule" — which action the link grants
//   - jti:  random id stored on the booking row at issue time
//
// Single-use enforcement happens at the route handler, not here. The
// handler queries the booking, compares the token's jti against the
// row's cancel_jti / reschedule_jti column, then clears the column on
// success. Once cleared, replays fail because the stored jti no longer
// matches. Reschedule chains naturally invalidate prior tokens the same
// way: rescheduling A→B clears A's jtis and issues fresh ones on B.
//
// We sign with HS256 using AUTH_SECRET (already in env) to avoid a
// separate secret for magic links. The 30-day expiry covers a typical
// booking window with comfortable margin; expired links fall through
// to the JWTExpiredError → "link expired, email rob@" UI.

import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { JWTExpiredError, JWTInvalidError } from "./errors/booking";

export const MAGIC_LINK_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type MagicLinkKind = "cancel" | "reschedule";

export interface MagicLinkPayload {
  bid: string;
  kind: MagicLinkKind;
  jti: string;
  iat?: number;
  exp?: number;
}

// 16 bytes → ~22 url-safe base64 chars, ~128 bits of entropy. Plenty.
export function generateJti(): string {
  return randomBytes(16).toString("base64url");
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new JWTInvalidError(
      "AUTH_SECRET is not set or too short (need at least 32 bytes) — magic-link signing unavailable",
    );
  }
  return new TextEncoder().encode(secret);
}

// Sign a magic link. The caller is responsible for persisting `jti` to
// booking_request.{cancel,reschedule}_jti before sending the link — that
// is the single source of truth for "is this jti still valid?".
export async function signMagicLink(
  bid: string,
  kind: MagicLinkKind,
  jti: string,
): Promise<string> {
  const secret = getSecret();
  return new SignJWT({ bid, kind, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAGIC_LINK_MAX_AGE_SECONDS}s`)
    .sign(secret);
}

// Verify signature + expiry + shape. Returns the payload on success.
// Throws JWTExpiredError when the exp claim is past, JWTInvalidError for
// anything else (bad signature, malformed payload, missing fields).
// JTI revocation is NOT checked here — that's the route's job (it has
// DB access).
export async function verifyMagicLink(
  token: string,
): Promise<MagicLinkPayload> {
  const secret = getSecret();
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, secret);
    payload = result.payload;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ERR_JWT_EXPIRED") {
      throw new JWTExpiredError("magic link has expired", { cause: err });
    }
    throw new JWTInvalidError("magic link signature or format invalid", {
      cause: err,
    });
  }

  // Shape check. jose validates the signature but doesn't enforce the
  // payload contract — we have to.
  if (
    typeof payload.bid !== "string" ||
    (payload.kind !== "cancel" && payload.kind !== "reschedule") ||
    typeof payload.jti !== "string"
  ) {
    throw new JWTInvalidError("magic link payload is malformed");
  }

  return payload as unknown as MagicLinkPayload;
}
