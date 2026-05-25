import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { users } from "../../../../lib/db/schema";
import {
  verifyPassword,
  ENUMERATION_DUMMY_HASH,
} from "../../../../lib/auth/password";
import { issueSession } from "../../../../lib/auth/session";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { logAuthEvent } from "../../../../lib/auth/audit";
import {
  assertSameOriginRequest,
  CsrfOriginError,
} from "../../../../lib/auth/csrf";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/login
// Password sign-in for the new account model. On success: issues a
// session and sets the archos_session cookie. On failure: returns 401
// with a generic error message AND runs the same argon2 work as the
// success path (via ENUMERATION_DUMMY_HASH) so response timing doesn't
// leak which emails are registered.
//
// Rate limit: per-IP to mitigate brute force across many emails;
// per-email to mitigate credential stuffing against one target.

const LOGIN_ATTEMPTS_PER_IP_PER_HOUR = 20;
const LOGIN_ATTEMPTS_PER_EMAIL_PER_HOUR = 10;

const LoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

// Generic error response — same shape for "no such user" and "wrong
// password" so the response body never reveals which.
const GENERIC_401 = {
  ok: false,
  error: "Invalid email or password.",
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
    `login:ip:${ip}`,
    LOGIN_ATTEMPTS_PER_IP_PER_HOUR,
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
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    // Same shape as bad-credentials. We don't even confirm the body
    // shape was valid — keeps an attacker probing for "is email a
    // valid format" from learning anything.
    return Response.json(GENERIC_401, { status: 401 });
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const emailLimit = rateLimit(
    `login:email:${normalizedEmail}`,
    LOGIN_ATTEMPTS_PER_EMAIL_PER_HOUR,
  );
  if (!emailLimit.ok) {
    return Response.json(
      { ok: false, error: "Too many attempts. Try again later." },
      { status: 429 },
    );
  }

  const db = getDb();
  const found = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
      displayName: users.displayName,
      role: users.role,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalizedEmail))
    .limit(1);

  const row = found[0];

  // Enumeration defense: every branch runs an argon2 verify against a
  // real hash. Wrong-password and no-such-user are indistinguishable
  // in wall-clock time.
  const hashToVerify =
    row && row.passwordHash ? row.passwordHash : ENUMERATION_DUMMY_HASH;
  const passwordOk = await verifyPassword(password, hashToVerify);

  // Branch-flatten: any of these conditions → 401 with the same shape.
  // (a) no user found, (b) password mismatch, (c) deactivated user,
  // (d) OAuth-only user (no password_hash).
  if (!row || !row.passwordHash || !row.isActive || !passwordOk) {
    // Log a failed-login row for audit. user_id is nullable so we
    // capture the attempt even when no user exists. Metadata records
    // a structured reason (not surfaced to the client).
    const reason = !row
      ? "unknown_email"
      : !row.passwordHash
        ? "no_password_set"
        : !row.isActive
          ? "deactivated"
          : "wrong_password";
    await logAuthEvent({
      userId: row?.id ?? null,
      eventType: "login_failed",
      ipAddress: ip || null,
      userAgent,
      metadata: { reason, normalizedEmail },
    });
    return Response.json(GENERIC_401, { status: 401 });
  }

  // Happy path. Issue session, set cookie, log event.
  const session = await issueSession({
    userId: row.id,
    ipAddress: ip || null,
    userAgent,
  });
  await setSessionCookie(session.cookieValue);

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, row.id));

  await logAuthEvent({
    userId: row.id,
    eventType: "login_password",
    ipAddress: ip || null,
    userAgent,
  });

  return Response.json({
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
    },
  });
}
