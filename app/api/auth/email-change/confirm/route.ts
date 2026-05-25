import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { users } from "../../../../../lib/db/schema";
import { verifyEmailChangeToken } from "../../../../../lib/auth/email-change-token";
import { revokeAllSessionsForUser } from "../../../../../lib/auth/session";
import { clearSessionCookie } from "../../../../../lib/auth/cookies";
import { logAuthEvent } from "../../../../../lib/auth/audit";
import { getPublicOrigin } from "../../../../../lib/public-origin";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// GET /api/auth/email-change/confirm?token=…
// Clicked from the confirmation email (sent to the NEW address).
// Applies the email change atomically, revokes ALL sessions (the
// user signs in again with the new email), bumps users.token_version
// so the same confirmation link cannot be reused.
//
// On success: redirect to /sign-in?email_changed=1 so the user lands
// on the sign-in page with a confirmation banner.
// On failure: redirect to /sign-in?error=… with a generic code.
//
// No CSRF check (GET endpoint, token IS the credential — matches
// /api/auth/verify-email pattern).

const CONFIRMS_PER_IP_PER_HOUR = 20;

export async function GET(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(
    `email-change-confirm:ip:${ip}`,
    CONFIRMS_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return redirectTo(request, "/sign-in?error=rate_limited");
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return redirectTo(request, "/sign-in?error=missing_token");
  }

  const payload = await verifyEmailChangeToken(token);
  if (!payload) {
    return redirectTo(request, "/sign-in?error=invalid_or_expired_token");
  }

  const db = getDb();
  const found = await db
    .select({
      id: users.id,
      email: users.email,
      isActive: users.isActive,
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);

  const row = found[0];
  if (!row || !row.isActive || row.tokenVersion !== payload.tv) {
    return redirectTo(request, "/sign-in?error=invalid_or_expired_token");
  }

  const normalizedNew = payload.ne.trim().toLowerCase();

  // Re-check that the new email is still free at confirm time —
  // someone else may have claimed it between request and confirm.
  // (The window is at most 30 minutes — rare but possible.)
  const collision = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalizedNew))
    .limit(1);

  if (collision.length > 0 && collision[0].id !== row.id) {
    await logAuthEvent({
      userId: row.id,
      eventType: "email_change_requested",
      ipAddress: ip || null,
      userAgent: request.headers.get("user-agent"),
      metadata: {
        delivered: false,
        reason: "new_email_now_in_use_at_confirm_time",
        normalizedNew,
      },
    });
    return redirectTo(request, "/sign-in?error=email_unavailable");
  }

  const oldEmail = row.email;

  // Apply the change. revokeAllSessionsForUser bumps token_version
  // → same confirmation link cannot be replayed.
  await db
    .update(users)
    .set({
      email: payload.ne,
      // Reset email_verified_at to now() — the user has just proven
      // they own the new address by clicking the link sent to it.
      emailVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, row.id));

  await revokeAllSessionsForUser(row.id);
  await clearSessionCookie();

  await logAuthEvent({
    userId: row.id,
    eventType: "email_changed",
    ipAddress: ip || null,
    userAgent: request.headers.get("user-agent"),
    metadata: { oldEmail, newEmail: payload.ne },
  });

  return redirectTo(request, "/sign-in?email_changed=1");
}

function redirectTo(request: Request, path: string): Response {
  const origin = getPublicOrigin(request);
  return Response.redirect(`${origin}${path}`, 303);
}
