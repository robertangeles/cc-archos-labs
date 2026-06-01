import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { assessmentSession, users } from "../../../../../lib/db/schema";
import { consumeMagicLinkToken } from "../../../../../lib/magic-link";
import { issueSession } from "../../../../../lib/auth/session";
import { setSessionCookie } from "../../../../../lib/auth/cookies";
import { getPublicOrigin } from "../../../../../lib/public-origin";

export const runtime = "nodejs";

const TokenSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/i, "Invalid token"),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = TokenSchema.safeParse({ token: searchParams.get("token") });
  if (!parsed.success) {
    return redirectTo(request, "/login?error=invalid_link");
  }

  const consumed = await consumeMagicLinkToken(parsed.data.token);
  if (!consumed || !consumed.userId) {
    return redirectTo(request, "/login?error=expired_link");
  }

  const db = getDb();

  // Stamp emailVerifiedAt on first magic-link verify (proves email ownership).
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(users.id, consumed.userId),
        eq(users.emailVerifiedAt, null as unknown as Date),
      ),
    );

  const session = await issueSession({
    userId: consumed.userId,
    ipAddress: null,
    userAgent: request.headers.get("user-agent"),
  });
  await setSessionCookie(session.cookieValue);

  // Redirect to the user's most recent completed report, or the portal.
  const latestSession = await db
    .select({ id: assessmentSession.id })
    .from(assessmentSession)
    .where(
      and(
        eq(assessmentSession.userId, consumed.userId),
        eq(assessmentSession.status, "completed"),
      ),
    )
    .orderBy(desc(assessmentSession.completedAt))
    .limit(1);

  if (latestSession.length > 0) {
    return redirectTo(
      request,
      `/tools/ai-readiness/report/${latestSession[0].id}`,
    );
  }

  return redirectTo(request, "/account");
}

function redirectTo(request: Request, path: string): Response {
  const url = new URL(path, getPublicOrigin(request));
  return Response.redirect(url.toString(), 302);
}
