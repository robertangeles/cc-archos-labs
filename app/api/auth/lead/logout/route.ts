import { clearLeadSessionCookie } from "../../../../../lib/auth-server";

export const runtime = "nodejs";

// POST /api/auth/lead/logout — clears the archos_lead_session cookie.
// No auth check: a request to log out is always safe to honour. If
// the visitor has no cookie, the response is the same (no-op).
//
// Mirrors POST /api/admin/logout for the admin session.

export async function POST() {
  await clearLeadSessionCookie();
  return Response.json({ ok: true });
}
