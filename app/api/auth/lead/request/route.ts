import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { lead } from "../../../../../lib/db/schema";
import { mintMagicLinkToken } from "../../../../../lib/magic-link";
import { getResend } from "../../../../../lib/resend";
import { buildMagicLinkEmail } from "../../../../../lib/email-templates";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// POST /api/auth/lead/request — entry point for the magic-link flow.
//
// Always returns 200 with a generic message so the response doesn't
// reveal whether the email is in our system (no enumeration). If the
// email matches a lead, we mint a token and send the link; otherwise
// we do nothing but still respond identically.

// Per-IP cap is the same shape as other auth endpoints. Per-email cap
// is tighter — 3 links per 15-min window is plenty for a forgetful user
// without becoming a free outbound-email channel for spammers.
const REQUESTS_PER_IP_PER_HOUR = 10;
const REQUESTS_PER_EMAIL_PER_15MIN = 3;

// The email→bucket cap reuses the hourly rate limiter with a tighter
// limit; the 60-min window over-protects but is acceptable for now.
// Tighter sliding windows arrive when we move limits behind Redis.
const EMAIL_BUCKET_LIMIT = REQUESTS_PER_EMAIL_PER_15MIN;

const RequestSchema = z.object({
  email: z.email({ error: "Enter a valid work email" }).max(254),
});

const GENERIC_OK = {
  ok: true,
  message:
    "If we have an account for that email, we just sent you a sign-in link.",
};

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const ipLimit = rateLimit(`magic-link:ip:${ip}`, REQUESTS_PER_IP_PER_HOUR);
  if (!ipLimit.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((ipLimit.resetAt - Date.now()) / 1000),
          ),
        },
      },
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

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const normalisedEmail = parsed.data.email.trim().toLowerCase();

  // Per-email cap to keep this endpoint from being a free email sender.
  const emailLimit = rateLimit(
    `magic-link:email:${normalisedEmail}`,
    EMAIL_BUCKET_LIMIT,
  );
  if (!emailLimit.ok) {
    // Return the generic OK so probing email-by-email gives the same
    // response shape as a rate-limited known email — no enumeration.
    return Response.json(GENERIC_OK);
  }

  // Look up the lead. If absent, return the generic message anyway.
  const db = getDb();
  const rows = await db
    .select({
      id: lead.id,
      firstName: lead.firstName,
    })
    .from(lead)
    .where(eq(lead.email, normalisedEmail))
    .limit(1);

  if (rows.length === 0) {
    return Response.json(GENERIC_OK);
  }

  const targetLead = rows[0];

  // Mint + send. If the send fails we log and still return the generic
  // success — the user can request another link. We never surface
  // delivery errors back to the client because they'd reveal that the
  // account exists.
  try {
    const minted = await mintMagicLinkToken(targetLead.id);
    const origin = new URL(request.url).origin;
    const magicLinkUrl = `${origin}/api/auth/lead/verify?token=${encodeURIComponent(
      minted.rawToken,
    )}`;

    const rendered = buildMagicLinkEmail({
      firstName: targetLead.firstName,
      magicLinkUrl,
      expiresInMinutes: Math.round(
        (minted.expiresAt.getTime() - Date.now()) / 60000,
      ),
    });

    const { resend, from } = getResend();
    await resend.emails.send({
      from,
      to: normalisedEmail,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  } catch (err) {
    console.error("Magic-link request failed:", err);
    // Swallow — generic response still returned.
  }

  return Response.json(GENERIC_OK);
}
