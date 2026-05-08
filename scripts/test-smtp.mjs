// One-off SMTP smoke test. Run with:
//   node --env-file=.env.local scripts/test-smtp.mjs
//
// Loads SMTP_* + CONTACT_RECIPIENT_EMAIL from .env.local, verifies the
// SMTP connection (auth + TLS), then sends a real test email. Use this
// to validate GoDaddy SMTP creds before deploying — lets you find auth
// issues, port issues, and TLS issues independently of Next.js.

import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST ?? "smtpout.secureserver.net";
const port = Number(process.env.SMTP_PORT ?? 465);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const recipient = process.env.CONTACT_RECIPIENT_EMAIL ?? user;

if (!user || !pass) {
  console.error(
    "Missing SMTP_USER or SMTP_PASS. Did you load .env.local? Try:\n" +
      "  node --env-file=.env.local scripts/test-smtp.mjs",
  );
  process.exit(1);
}

console.log(`SMTP config: ${host}:${port} as ${user}`);
console.log(`Recipient:   ${recipient}`);
console.log("");

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
  // Single connection only — GoDaddy counts verify() + sendMail() as
  // concurrent and throttles aggressively (421 Too many concurrent SMTP
  // connections). Skip verify; auth errors will surface in sendMail.
  pool: false,
});

console.log("Sending test email...");
const sentAt = new Date().toISOString();

try {
  const info = await transporter.sendMail({
    from: `Archos Labs <${user}>`,
    to: recipient,
    subject: `Archos Labs SMTP test — ${sentAt}`,
    text:
      `Test message from scripts/test-smtp.mjs.\n\n` +
      `Sent at: ${sentAt}\n` +
      `From:    ${user}\n` +
      `To:      ${recipient}\n` +
      `Via:     ${host}:${port}\n\n` +
      `If this lands in your inbox, the contact-form SMTP path works end-to-end.\n`,
  });
  console.log("      OK — messageId:", info.messageId);
  console.log("      response:", info.response);
  console.log("");
  console.log(`Now check ${recipient} inbox (and Junk).`);
} catch (err) {
  console.error("      Send FAILED:", err.message);
  process.exit(1);
}
