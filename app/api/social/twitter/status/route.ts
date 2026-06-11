import { getCurrentUser } from "../../../../../lib/auth/current-user";
import { getSocialAccount } from "../../../../../lib/social/token";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// GET /api/social/twitter/status
// Returns whether the authenticated user has a connected Twitter
// account and, if so, the account display name (e.g. @username).

const STATUS_PER_IP_PER_HOUR = 60;

export async function GET(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`twitter-status:ip:${ip}`, STATUS_PER_IP_PER_HOUR);
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

  const account = await getSocialAccount(session.user.id, "twitter");

  if (!account || !account.isConnected) {
    return Response.json({ connected: false });
  }

  return Response.json({
    connected: true,
    accountName: account.accountIdentifier,
  });
}
