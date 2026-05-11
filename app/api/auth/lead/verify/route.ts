import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { assessmentSession } from "../../../../../lib/db/schema";
import { consumeMagicLinkToken } from "../../../../../lib/magic-link";
import { signLeadSession } from "../../../../../lib/auth-lead";
import { setLeadSessionCookie } from "../../../../../lib/auth-server";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// GET /api/auth/lead/verify?token=… — clicked from the magic-link email.
//
// Happy path: consume the token, mint a fresh lead session cookie,
// redirect to the lead's most-recent completed report. Any failure
// (missing/expired/already-used token, lead with no completed session)
// redirects back to /sign-in with a generic error code in the URL —
// the page renders a recoverable message and lets them request a new
// link. We never tell the user whether the token existed at all.

const VERIFIES_PER_IP_PER_HOUR = 20;

export async function GET(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`magic-link:verify:${ip}`, VERIFIES_PER_IP_PER_HOUR);
  if (!limit.ok) {
    return redirectTo(request, "/sign-in?error=rate_limited");
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return redirectTo(request, "/sign-in?error=missing_token");
  }

  const consumed = await consumeMagicLinkToken(token);
  if (!consumed) {
    return redirectTo(request, "/sign-in?error=expired_link");
  }

  // Find the lead's most-recent completed session — that's the report
  // they'll see on sign-in. Future "your reports" listing page (W5)
  // changes this to a portal; for now, latest report wins.
  const db = getDb();
  const rows = await db
    .select({ id: assessmentSession.id })
    .from(assessmentSession)
    .where(
      and(
        eq(assessmentSession.leadId, consumed.leadId),
        eq(assessmentSession.status, "completed"),
      ),
    )
    .orderBy(desc(assessmentSession.completedAt))
    .limit(1);

  if (rows.length === 0) {
    // Edge case: a lead exists but never completed a session. Shouldn't
    // happen with the current flow (registration only fires post-Q12)
    // but defend against it rather than 500.
    return redirectTo(request, "/sign-in?error=no_report");
  }

  const sessionId = rows[0].id;

  // Mint cookie and redirect to the report. The cookie is set on the
  // redirect response so the next request — to the report page —
  // carries it.
  const jwt = await signLeadSession(consumed.leadId);
  await setLeadSessionCookie(jwt);

  return redirectTo(request, `/tools/ai-readiness/report/${sessionId}`);
}

function redirectTo(request: Request, path: string): Response {
  const url = new URL(path, new URL(request.url).origin);
  return Response.redirect(url, 302);
}
