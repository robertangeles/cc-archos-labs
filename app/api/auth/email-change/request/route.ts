import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { users } from "../../../../../lib/db/schema";
import { getCurrentUser } from "../../../../../lib/auth/current-user";
import { signEmailChangeToken } from "../../../../../lib/auth/email-change-token";
import { logAuthEvent } from "../../../../../lib/auth/audit";
import {
  assertSameOriginRequest,
  CsrfOriginError,
} from "../../../../../lib/auth/csrf";
import { getResend } from "../../../../../lib/resend";
import { buildEmailChangeConfirmEmail } from "../../../../../lib/email-templates";
import { getPublicOrigin } from "../../../../../lib/public-origin";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/email-change/request
// Authenticated. Body: { newEmail }
// Sends a confirmation link to the NEW email address. The OLD email
// never receives the link — that's the security property: if the
// session is hijacked and an attacker requests a change, the legit
// owner at the OLD address never sees the confirmation, so the
// attacker still has to own the new inbox.
//
// Returns 200 even when the new email is already in use by someone
// else, so the response doesn't leak email-existence. We just don't
// send the link.

const REQUESTS_PER_USER_PER_HOUR = 3;

const RequestSchema = z.object({
  newEmail: z.email().max(254),
});

const GENERIC_OK = {
  ok: true,
  message: "Check the new inbox for a confirmation link.",
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

  const session = await getCurrentUser();
  if (!session) {
    return Response.json(
      { ok: false, error: "Sign in to change your email." },
      { status: 401 },
    );
  }

  const ip = clientIpFromRequest(request);
  const userAgent = request.headers.get("user-agent");

  const userLimit = rateLimit(
    `email-change:user:${session.user.id}`,
    REQUESTS_PER_USER_PER_HOUR,
  );
  if (!userLimit.ok) {
    return Response.json(GENERIC_OK);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(GENERIC_OK);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(GENERIC_OK);
  }

  const normalizedNew = parsed.data.newEmail.trim().toLowerCase();
  const normalizedCurrent = session.user.email.trim().toLowerCase();

  // Same-email no-op — return generic OK without sending.
  if (normalizedNew === normalizedCurrent) {
    return Response.json(GENERIC_OK);
  }

  // Check for collision. If the new email belongs to another user,
  // silently skip the send (response is identical so we don't leak).
  const db = getDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalizedNew))
    .limit(1);

  if (existing.length > 0) {
    await logAuthEvent({
      userId: session.user.id,
      eventType: "email_change_requested",
      ipAddress: ip || null,
      userAgent,
      metadata: {
        delivered: false,
        reason: "new_email_in_use",
        normalizedNew,
      },
    });
    return Response.json(GENERIC_OK);
  }

  // Best-effort send to the NEW address.
  try {
    const token = await signEmailChangeToken(
      session.user.id,
      session.user.tokenVersion,
      normalizedNew,
    );
    const confirmUrl = `${getPublicOrigin(request)}/api/auth/email-change/confirm?token=${encodeURIComponent(token)}`;
    const firstName =
      (session.user.displayName ?? session.user.email).split(" ")[0] || "there";

    const email = buildEmailChangeConfirmEmail({
      firstName,
      newEmail: normalizedNew,
      confirmUrl,
      expiresInMinutes: 30,
    });

    const { resend, from } = await getResend();
    await resend.emails.send({
      from,
      to: normalizedNew,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    await logAuthEvent({
      userId: session.user.id,
      eventType: "email_change_requested",
      ipAddress: ip || null,
      userAgent,
      metadata: { delivered: true, normalizedNew },
    });
  } catch (err) {
    console.error(
      "[/api/auth/email-change/request] send failed:",
      err instanceof Error ? err.message : String(err),
    );
    await logAuthEvent({
      userId: session.user.id,
      eventType: "email_change_requested",
      ipAddress: ip || null,
      userAgent,
      metadata: { delivered: false, reason: "send_failed", normalizedNew },
    });
  }

  return Response.json(GENERIC_OK);
}
