import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { users } from "../../../../../lib/db/schema";
import { hashPassword } from "../../../../../lib/auth/password";
import { verifyPasswordResetToken } from "../../../../../lib/auth/password-reset-token";
import { revokeAllSessionsForUser } from "../../../../../lib/auth/session";
import { clearSessionCookie } from "../../../../../lib/auth/cookies";
import { logAuthEvent } from "../../../../../lib/auth/audit";
import {
  assertSameOriginRequest,
  CsrfOriginError,
} from "../../../../../lib/auth/csrf";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/password-reset/confirm
// Body: { token, newPassword }
// Verifies the reset token, applies the new password hash, revokes
// ALL sessions for the user (including any in-progress session in
// another tab) and bumps users.token_version so the same reset token
// can never be used again.
//
// Clears the current session cookie if one happens to be set —
// password-reset is the "I forgot, signed out" flow; we don't keep
// the current cookie alive after a successful reset.

const CONFIRMS_PER_IP_PER_HOUR = 10;

const ConfirmSchema = z.object({
  token: z.string().min(10).max(2048),
  newPassword: z.string().min(8).max(128),
});

const GENERIC_400 = {
  ok: false,
  error: "Invalid or expired reset link. Request a new one.",
};

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
  const userAgent = request.headers.get("user-agent");

  const ipLimit = rateLimit(
    `pw-reset-confirm:ip:${ip}`,
    CONFIRMS_PER_IP_PER_HOUR,
  );
  if (!ipLimit.ok) {
    return Response.json(
      { ok: false, error: "Too many attempts. Try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(GENERIC_400, { status: 400 });
  }

  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(GENERIC_400, { status: 400 });
  }

  const { token, newPassword } = parsed.data;

  const payload = await verifyPasswordResetToken(token);
  if (!payload) {
    return Response.json(GENERIC_400, { status: 400 });
  }

  // Load the user to verify (a) they exist + active, (b) the token's
  // tv claim matches the current users.token_version (single-use
  // enforcement). Replay after success: token_version has been
  // bumped, mismatch → reject.
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
    return Response.json(GENERIC_400, { status: 400 });
  }

  const newHash = await hashPassword(newPassword);

  // Apply the new hash. Note we update users.token_version explicitly
  // here too because revokeAllSessionsForUser ALSO bumps it; either
  // way it ends up bumped exactly once per reset. We rely on
  // revokeAllSessionsForUser as the canonical bump point.
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, row.id));

  await revokeAllSessionsForUser(row.id);

  // Clear the cookie if one was sent — user must sign in fresh.
  await clearSessionCookie();

  await logAuthEvent({
    userId: row.id,
    eventType: "password_changed",
    ipAddress: ip || null,
    userAgent,
    metadata: { via: "reset_link" },
  });

  return Response.json({
    ok: true,
    message: "Password reset. Sign in with your new password.",
  });
}
