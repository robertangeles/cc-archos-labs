import { SignJWT, jwtVerify } from "jose";

// Edge-compatible lead-session JWT helpers — distinct from the admin
// session in lib/auth.ts. Two cookies live on the same domain:
//
//   archos_admin_session  → JWT with { admin: true } (24h TTL).
//                           Gates /admin/** + /api/admin/**.
//   archos_lead_session   → JWT with { leadId } (30d TTL).
//                           Gates ownership of an assessment session
//                           and its report.
//
// Both signed with the same AUTH_SECRET — separate cookie names keep
// payload shapes distinct and prevent admin-cookie reuse for the
// lead path (and vice-versa).
//
// Cookie reading/writing for server components and route handlers
// lives in lib/auth-server.ts to keep this file safe to import from
// middleware (Edge runtime — no next/headers).

export const LEAD_SESSION_COOKIE = "archos_lead_session";

// 30 days. Long-lived because the spec's return-visitor flow
// (§2.3) lets users come back to read their report any time. Magic-
// link sign-in (W4 Pass 2) refreshes this cookie when an existing
// user verifies a new link.
export const LEAD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface LeadSessionPayload {
  leadId: string;
  iat?: number;
  exp?: number;
}

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is not set or too short (need at least 32 bytes). " +
        "Same secret as the admin session — generate with: openssl rand -base64 32",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signLeadSession(leadId: string): Promise<string> {
  const secret = getAuthSecret();
  return new SignJWT({ leadId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${LEAD_SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret);
}

export async function verifyLeadSession(
  token: string,
): Promise<LeadSessionPayload | null> {
  try {
    const secret = getAuthSecret();
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.leadId !== "string" || payload.leadId.length === 0) {
      return null;
    }
    return payload as unknown as LeadSessionPayload;
  } catch {
    return null;
  }
}
