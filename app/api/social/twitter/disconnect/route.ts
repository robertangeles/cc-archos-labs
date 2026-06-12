import { getCurrentUser } from "../../../../../lib/auth/current-user";
import { deleteSocialAccount } from "../../../../../lib/social/token";
import {
  assertSameOriginRequest,
  CsrfOriginError,
} from "../../../../../lib/auth/csrf";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/social/twitter/disconnect
// Removes the user's Twitter connection (hard delete of the
// social_account row). Requires authentication and CSRF check.

const DISCONNECTS_PER_IP_PER_HOUR = 20;

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
  } catch (err) {
    if (err instanceof CsrfOriginError) {
      return Response.json({ ok: false, error: "csrf" }, { status: 403 });
    }
    throw err;
  }

  const ip = clientIpFromRequest(request);
  const limit = rateLimit(
    `twitter-disconnect:ip:${ip}`,
    DISCONNECTS_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

  const session = await getCurrentUser();
  if (!session) {
    return Response.json(
      { ok: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  await deleteSocialAccount(session.user.id, "twitter");

  return Response.json({ ok: true });
}
