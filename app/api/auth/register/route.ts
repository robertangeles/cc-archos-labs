import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { users } from "../../../../lib/db/schema";
import { hashPassword } from "../../../../lib/auth/password";
import { issueSession } from "../../../../lib/auth/session";
import { signVerificationToken } from "../../../../lib/auth/verification-token";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { logAuthEvent } from "../../../../lib/auth/audit";
import { assertSameOriginRequest, CsrfOriginError } from "../../../../lib/auth/csrf";
import { getResend } from "../../../../lib/resend";
import { buildVerificationEmail } from "../../../../lib/email-templates";
import { getPublicOrigin } from "../../../../lib/public-origin";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/register
// New public account creation. Creates a users row with role='member',
// argon2id-hashed password, email_verified_at NULL. Sends a verification
// email. Issues a session cookie immediately — users land "signed in,
// pending verification"; gated features can check `emailVerifiedAt`.
//
// Rate limits keep this from becoming a free outbound-email channel.

const REGISTRATIONS_PER_IP_PER_HOUR = 5;
const REGISTRATIONS_PER_EMAIL_PER_HOUR = 2;

const RegisterSchema = z.object({
  email: z.email({ error: "Enter a valid email" }).max(254),
  // OWASP recommended floor of 8; upper bound at 128 to defeat
  // denial-of-service via giant argon2 inputs.
  password: z.string().min(8).max(128),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});

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
  const ipLimit = rateLimit(
    `register:ip:${ip}`,
    REGISTRATIONS_PER_IP_PER_HOUR,
  );
  if (!ipLimit.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Validation failed.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { email, password, firstName, lastName } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  // Per-email rate limit (in addition to per-IP) — defeats one IP
  // burning many emails AND one email getting hammered from many IPs.
  const emailLimit = rateLimit(
    `register:email:${normalizedEmail}`,
    REGISTRATIONS_PER_EMAIL_PER_HOUR,
  );
  if (!emailLimit.ok) {
    return Response.json(
      { ok: false, error: "Too many attempts for this email. Try again later." },
      { status: 429 },
    );
  }

  const db = getDb();

  // Reject duplicate email with 409. Returning 409 leaks that the email
  // is already registered, but this is a registration endpoint — that's
  // useful UX (so users know to sign in instead). For password-reset
  // and login, we DON'T leak; for register, the leak is intentional.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalizedEmail))
    .limit(1);

  if (existing.length > 0) {
    return Response.json(
      {
        ok: false,
        error: "An account with that email already exists. Try signing in.",
      },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const displayName = `${firstName} ${lastName}`.trim().slice(0, 200);

  const inserted = await db
    .insert(users)
    .values({
      email: email.trim(),
      displayName,
      role: "member",
      passwordHash,
      isActive: true,
      tokenVersion: 0,
      emailVerifiedAt: null,
    })
    .returning({ id: users.id });

  const userId = inserted[0].id;
  const userAgent = request.headers.get("user-agent");

  // Issue a session immediately. Users land signed-in-but-unverified;
  // gated features check `emailVerifiedAt`.
  const session = await issueSession({
    userId,
    ipAddress: ip || null,
    userAgent,
  });
  await setSessionCookie(session.cookieValue);

  // Best-effort audit. logAuthEvent never throws.
  await logAuthEvent({
    userId,
    eventType: "register",
    ipAddress: ip || null,
    userAgent,
  });

  // Send verification email. Don't fail registration if Resend hiccups —
  // the user can request another verification link from /account later.
  try {
    const verifyToken = await signVerificationToken(userId);
    const verifyUrl = `${getPublicOrigin(request)}/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;

    const verifyEmail = buildVerificationEmail({
      firstName,
      verifyUrl,
      expiresInHours: 24,
    });

    const { resend, from } = await getResend();
    await resend.emails.send({
      from,
      to: normalizedEmail,
      subject: verifyEmail.subject,
      text: verifyEmail.text,
      html: verifyEmail.html,
    });
  } catch (err) {
    console.error(
      "[/api/auth/register] verification email send failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return Response.json(
    {
      ok: true,
      message:
        "Account created. Check your inbox for a verification link.",
      user: { id: userId, email: normalizedEmail, displayName },
    },
    { status: 201 },
  );
}
