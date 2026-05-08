import { z } from "zod";
import { resend, RESEND_FROM } from "../../../lib/resend";
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

  const recipient =
    process.env.CONTACT_RECIPIENT_EMAIL ?? "rob.angeles@archoslabs.xyz";

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
    const result = await resend.emails.send({
      from: RESEND_FROM,
      to: recipient,
      replyTo: email,
      subject: `Archos Labs enquiry — ${name} (${organisation})`,
      text,
    });

    if (result.error) {
      // Resend returned a structured error (domain not verified, etc.).
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
