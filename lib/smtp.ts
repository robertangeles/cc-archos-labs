import nodemailer, { type Transporter } from "nodemailer";

// Server-only SMTP transporter. Used by the contact form so mail lands
// in the GoDaddy-hosted mailbox at archoslabs.xyz reliably — Resend's
// external SMTP relays are silently dropped by GoDaddy's anti-spoofing
// filter for mail claiming to be from a domain GoDaddy hosts. Sending
// via GoDaddy's own outbound server avoids that path entirely.
//
// Resend stays in the project (lib/resend.ts) for Phase 2 — assessment
// reports and magic-link auth go to external prospects (Gmail/Outlook),
// where Resend's deliverability beats GoDaddy SMTP comfortably.
//
// Validation runs lazily on first call. Validating at module load would
// crash any build in environments without env vars set.

let cachedTransporter: Transporter | null = null;

export function getMailer(): { transporter: Transporter; from: string } {
  const host = process.env.SMTP_HOST ?? "mail.archoslabs.xyz";
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user;
  // When connecting via the customer-friendly mail.<domain> hostname,
  // the TLS cert lives on the underlying cPanel server (e.g.
  // sg2plzcpnl493903.prod.sin2.secureserver.net). Set servername so
  // nodemailer validates the cert against the name it actually covers.
  const servername = process.env.SMTP_TLS_SERVERNAME;

  if (!user) {
    throw new Error(
      "SMTP_USER is not set. Add the GoDaddy mailbox address (e.g. rob.angeles@archoslabs.xyz) to .env.local or the Render env vars.",
    );
  }
  if (!pass) {
    throw new Error(
      "SMTP_PASS is not set. Add the GoDaddy mailbox password to .env.local or the Render env vars.",
    );
  }

  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      ...(servername ? { tls: { servername } } : {}),
    });
  }

  return { transporter: cachedTransporter, from: from! };
}
