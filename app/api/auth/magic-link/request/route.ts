import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { users } from "../../../../../lib/db/schema";
import { mintUserMagicLinkToken } from "../../../../../lib/magic-link";
import { getResend } from "../../../../../lib/resend";
import { buildMagicLinkEmail } from "../../../../../lib/email-templates";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";
import { getPublicOrigin } from "../../../../../lib/public-origin";

export const runtime = "nodejs";

const REQUESTS_PER_IP_PER_HOUR = 10;
const REQUESTS_PER_EMAIL_PER_15MIN = 3;

const RequestSchema = z.object({
  email: z.email({ error: "Enter a valid email" }).max(254),
});

const GENERIC_OK = {
  ok: true,
  message:
    "If we have an account for that email, we just sent you a sign-in link.",
};

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const ipLimit = rateLimit(`magic-link-user:ip:${ip}`, REQUESTS_PER_IP_PER_HOUR);
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

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const normalisedEmail = parsed.data.email.trim().toLowerCase();

  const emailLimit = rateLimit(
    `magic-link-user:email:${normalisedEmail}`,
    REQUESTS_PER_EMAIL_PER_15MIN,
  );
  if (!emailLimit.ok) {
    return Response.json(GENERIC_OK);
  }

  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.email, normalisedEmail))
    .limit(1);

  if (rows.length === 0) {
    return Response.json(GENERIC_OK);
  }

  const targetUser = rows[0];

  try {
    const minted = await mintUserMagicLinkToken(targetUser.id);
    const origin = getPublicOrigin(request);
    const magicLinkUrl = `${origin}/api/auth/magic-link/verify?token=${encodeURIComponent(
      minted.rawToken,
    )}`;

    const firstName = targetUser.displayName?.split(" ")[0] ?? "there";
    const rendered = buildMagicLinkEmail({
      firstName,
      magicLinkUrl,
      expiresInMinutes: Math.round(
        (minted.expiresAt.getTime() - Date.now()) / 60000,
      ),
    });

    const { resend, from } = await getResend();
    await resend.emails.send({
      from,
      to: normalisedEmail,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  } catch (err) {
    console.error("User magic-link request failed:", err);
  }

  return Response.json(GENERIC_OK);
}
