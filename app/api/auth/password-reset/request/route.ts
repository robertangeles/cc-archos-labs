import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { users } from "../../../../../lib/db/schema";
import { signPasswordResetToken } from "../../../../../lib/auth/password-reset-token";
import { logAuthEvent } from "../../../../../lib/auth/audit";
import {
  assertSameOriginRequest,
  CsrfOriginError,
} from "../../../../../lib/auth/csrf";
import { requireTurnstile } from "../../../../../lib/auth/turnstile";
import { getResend } from "../../../../../lib/resend";
import { buildPasswordResetEmail } from "../../../../../lib/email-templates";
import { getPublicOrigin } from "../../../../../lib/public-origin";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/password-reset/request
// Always returns 200 with a generic message so the response doesn't
// leak whether the email is in our system (no enumeration). If the
// email matches an active user with a password set, we mint a 15-min
// JWT and send the link; otherwise we do nothing but still respond
// identically.
//
// Single-use enforced via users.token_version: the JWT carries the
// version at mint time; the confirm endpoint applies the reset AND
// bumps the version via revokeAllSessionsForUser → token can never
// be reused.

const REQUESTS_PER_IP_PER_HOUR = 10;
const REQUESTS_PER_EMAIL_PER_HOUR = 3;

const RequestSchema = z.object({
  email: z.email().max(254),
  // Cloudflare Turnstile token. Optional; required only when
  // TURNSTILE_ENABLED is set (requireTurnstile bypasses otherwise).
  turnstileToken: z.string().max(2048).optional(),
});

const GENERIC_OK = {
  ok: true,
  message:
    "If we have an account for that email, we just sent you a password-reset link.",
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
    `pw-reset:ip:${ip}`,
    REQUESTS_PER_IP_PER_HOUR,
  );
  if (!ipLimit.ok) {
    return Response.json(GENERIC_OK); // rate-limited path also gives the
    // generic response — never reveal that the IP is being throttled.
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(GENERIC_OK); // even malformed body returns generic 200.
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(GENERIC_OK);
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  // Bot-protection gate. No-op when TURNSTILE_ENABLED is unset.
  // On Turnstile failure: same GENERIC_OK shape as every other
  // skipped branch so the response never reveals whether the email
  // was a real user (anti-enumeration).
  const tsResult = await requireTurnstile({
    token: parsed.data.turnstileToken,
    remoteIp: ip || null,
  });
  if (!tsResult.ok) {
    return Response.json(GENERIC_OK);
  }

  // Per-email rate limit. Hits return GENERIC_OK so the rate-limit
  // existence itself doesn't reveal the email is in our system.
  const emailLimit = rateLimit(
    `pw-reset:email:${normalizedEmail}`,
    REQUESTS_PER_EMAIL_PER_HOUR,
  );
  if (!emailLimit.ok) {
    return Response.json(GENERIC_OK);
  }

  const db = getDb();
  const found = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalizedEmail))
    .limit(1);

  const row = found[0];

  // Skip the email send if no user, deactivated, or OAuth-only (no
  // password to reset). All paths still return GENERIC_OK so the
  // response is indistinguishable from the success case.
  if (!row || !row.isActive || !row.passwordHash) {
    await logAuthEvent({
      userId: row?.id ?? null,
      eventType: "password_reset_requested",
      ipAddress: ip || null,
      userAgent,
      metadata: {
        delivered: false,
        reason: !row
          ? "unknown_email"
          : !row.isActive
            ? "deactivated"
            : "no_password_set",
      },
    });
    return Response.json(GENERIC_OK);
  }

  // Best-effort send. Don't surface failures to the response.
  try {
    const token = await signPasswordResetToken(row.id, row.tokenVersion);
    const resetUrl = `${getPublicOrigin(request)}/auth/password-reset/${encodeURIComponent(token)}`;
    const firstName = (row.displayName ?? row.email).split(" ")[0] || "there";

    const email = buildPasswordResetEmail({
      firstName,
      resetUrl,
      expiresInMinutes: 15,
    });

    const { resend, from } = await getResend();
    await resend.emails.send({
      from,
      to: row.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    await logAuthEvent({
      userId: row.id,
      eventType: "password_reset_requested",
      ipAddress: ip || null,
      userAgent,
      metadata: { delivered: true },
    });
  } catch (err) {
    console.error(
      "[/api/auth/password-reset/request] send failed:",
      err instanceof Error ? err.message : String(err),
    );
    await logAuthEvent({
      userId: row.id,
      eventType: "password_reset_requested",
      ipAddress: ip || null,
      userAgent,
      metadata: { delivered: false, reason: "send_failed" },
    });
  }

  return Response.json(GENERIC_OK);
}
