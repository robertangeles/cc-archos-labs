import {
  clearSessionCookie,
  getSessionJwtFromCookies,
} from "../../../../lib/auth/cookies";
import { revokeSession } from "../../../../lib/auth/session";
import { logAuthEvent } from "../../../../lib/auth/audit";
import {
  assertSameOriginRequest,
  CsrfOriginError,
} from "../../../../lib/auth/csrf";
import { clientIpFromRequest } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/logout
// Revokes the current session row + clears the archos_session cookie.
// Always returns 200 — logout is idempotent. If the cookie was already
// missing or the session already revoked, we still clear the cookie
// and respond cleanly.

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
  } catch (err) {
    if (err instanceof CsrfOriginError) {
      return Response.json({ ok: false, error: "csrf" }, { status: 403 });
    }
    throw err;
  }

  const payload = await getSessionJwtFromCookies();
  const ip = clientIpFromRequest(request);
  const userAgent = request.headers.get("user-agent");

  if (payload) {
    // Best-effort revoke. revokeSession's WHERE clause is
    // (id = ? AND revoked_at IS NULL) so a double-logout is a no-op.
    // Best-effort DB revoke. If the DB is unreachable, we MUST still clear
    // the cookie below — otherwise a transient DB failure strands the user
    // signed in (the route would 500 before clearSessionCookie ran, and the
    // client only catches network errors, not 500s). Sign-out must always
    // succeed client-side.
    try {
      await revokeSession(payload.sessionId);
      await logAuthEvent({
        userId: payload.userId,
        eventType: "logout",
        ipAddress: ip || null,
        userAgent,
      });
    } catch (err) {
      console.error(
        "[/api/auth/logout] session revoke failed; clearing cookie anyway:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await clearSessionCookie();

  return Response.json({ ok: true });
}
