import { eq } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { users } from "../../../../lib/db/schema";
import { verifyVerificationToken } from "../../../../lib/auth/verification-token";
import { logAuthEvent } from "../../../../lib/auth/audit";
import { getPublicOrigin } from "../../../../lib/public-origin";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../lib/rate-limit";

export const runtime = "nodejs";

// GET /api/auth/verify-email?token=…
// Clicked from the verification email. Consumes the JWT, sets
// users.email_verified_at = now() if it was NULL. Idempotent — clicking
// twice just no-ops the second time.
//
// On success: redirect to /account?verified=1 so the user sees a
// confirmation banner. (The /account page will land in T7; for now the
// redirect target exists as a fragment param the future page can read.)
//
// On failure: redirect to /login?error=… with a generic error code.
// We never reveal whether the token was valid-but-expired vs forged.
//
// No CSRF check — this is GET (no side effect from the request itself;
// the verification side effect IS the action being authenticated by
// the token, which IS the credential). Same posture as the existing
// magic-link verify endpoint at /api/auth/lead/verify.

const VERIFIES_PER_IP_PER_HOUR = 30;

export async function GET(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(
    `verify-email:ip:${ip}`,
    VERIFIES_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return redirectTo(request, "/login?error=rate_limited");
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return redirectTo(request, "/login?error=missing_token");
  }

  const userId = await verifyVerificationToken(token);
  if (!userId) {
    return redirectTo(request, "/login?error=invalid_or_expired_token");
  }

  const db = getDb();
  // Read first so we can determine "newly verified" vs "already verified"
  // — only emit an auth_event on the transition.
  const found = await db
    .select({
      id: users.id,
      email: users.email,
      isActive: users.isActive,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = found[0];
  if (!row) {
    // User got deleted between mint and verify. Same generic error.
    return redirectTo(request, "/login?error=invalid_or_expired_token");
  }
  if (!row.isActive) {
    return redirectTo(request, "/login?error=account_deactivated");
  }

  const newlyVerified = row.emailVerifiedAt === null;

  if (newlyVerified) {
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));

    await logAuthEvent({
      userId,
      eventType: "email_changed",
      ipAddress: ip || null,
      userAgent: request.headers.get("user-agent"),
      metadata: { kind: "initial_verification", email: row.email },
    });
  }

  return redirectTo(request, "/account?verified=1");
}

function redirectTo(request: Request, path: string): Response {
  const origin = getPublicOrigin(request);
  return Response.redirect(`${origin}${path}`, 303);
}
