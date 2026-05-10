import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifySession,
  type SessionPayload,
} from "./auth";
import {
  LEAD_SESSION_COOKIE,
  LEAD_SESSION_MAX_AGE_SECONDS,
  verifyLeadSession,
  type LeadSessionPayload,
} from "./auth-lead";

// Server-only auth helpers. Uses next/headers — DO NOT import from
// middleware/proxy.ts (Edge runtime). For middleware, read cookies
// via request.cookies and call the corresponding verify* directly.
//
// Two parallel session types live here:
//   1. Admin session (lib/auth.ts, archos_admin_session, 24h)
//   2. Lead session (lib/auth-lead.ts, archos_lead_session, 30d)

// ----------------------------------------------------------------------------
// Admin session
// ----------------------------------------------------------------------------

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

// ----------------------------------------------------------------------------
// Lead session
// ----------------------------------------------------------------------------

export async function setLeadSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(LEAD_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LEAD_SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearLeadSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(LEAD_SESSION_COOKIE);
}

export async function getLeadFromCookies(): Promise<LeadSessionPayload | null> {
  const store = await cookies();
  const token = store.get(LEAD_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyLeadSession(token);
}
