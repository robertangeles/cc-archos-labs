import { z } from "zod";
import { getResend } from "../../../lib/resend";
import { getIntegrationConfig } from "../../../lib/integration-config";
import { rateLimit, clientIpFromRequest } from "../../../lib/rate-limit";

export const runtime = "nodejs";

// CLAUDE.md: rate limit all API endpoints — max 100/IP/hour.
const RATE_LIMIT_PER_HOUR = 100;

// Field constraints. Tight enough to refuse abuse, generous enough for real
// enterprise enquiries. Plain-text body only — never render submitted content
// as HTML in the email we forward to ourselves.
const ContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.email({ error: "Enter a valid work email" }).max(254),
  organisation: z.string().trim().min(1, "Organisation is required").max(200),
  message: z.string().trim().min(10, "Tell us a little more").max(4000),
  // Honeypot. Real users don't fill this; bots usually do. Reject if present.
  website: z.string().max(0).optional(),
});

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`contact:${ip}`, RATE_LIMIT_PER_HOUR);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Response.json(
      { ok: false, error: first?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  // Honeypot triggered — pretend success so bots don't probe.
  if (parsed.data.website) {
    return Response.json({ ok: true });
  }

  const recipient = await getContactRecipient();

  const { name, email, organisation, message } = parsed.data;

  // Plain-text body. No HTML interpolation of user input — defends against
  // any HTML/script injection in the forwarded email.
  const text = [
    `New enquiry from archoslabs.xyz`,
    ``,
    `Name:         ${name}`,
    `Email:        ${email}`,
    `Organisation: ${organisation}`,
    ``,
    `Message:`,
    message,
    ``,
    `--`,
    `Source IP:    ${ip}`,
    `Submitted:    ${new Date().toISOString()}`,
  ].join("\n");

  try {
    const { resend, from } = await getResend();
    const result = await resend.emails.send({
      from,
      to: recipient,
      replyTo: email,
      subject: `Archos Labs enquiry — ${name} (${organisation})`,
      text,
    });

    if (result.error) {
      console.error("Resend send failed:", result.error);
      return Response.json(
        {
          ok: false,
          error: "We couldn't send your message right now. Please try again.",
        },
        { status: 502 },
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Contact form crash:", err);
    return Response.json(
      {
        ok: false,
        error: "We couldn't send your message right now. Please try again.",
      },
      { status: 500 },
    );
  }
}

// Resolves the email address that receives contact-form submissions.
// Reads from the DB-backed integration_secrets row (or env fallback
// during the grace window). Falls back to a hardcoded address only if
// the loader is unreachable AND no env value is set — last-resort
// defense so a misconfiguration doesn't black-hole a real enquiry.
async function getContactRecipient(): Promise<string> {
  try {
    const config = await getIntegrationConfig();
    if (config.contactRecipientEmail) return config.contactRecipientEmail;
  } catch (err) {
    console.error(
      "[contact] integration config unreachable, falling back:",
      err,
    );
  }
  return process.env.CONTACT_RECIPIENT_EMAIL ?? "rob.angeles@archoslabs.xyz";
}
