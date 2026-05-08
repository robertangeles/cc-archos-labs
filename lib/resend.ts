import { Resend } from "resend";

// Server-only Resend client. Never imported into client components.
// Throws at module load if RESEND_API_KEY is missing — fails fast in dev,
// surfaces a clear error in prod logs rather than silently no-op'ing.

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.RESEND_FROM_EMAIL;

if (!apiKey) {
  throw new Error(
    "RESEND_API_KEY is not set. Add it to .env.local (see .env.example).",
  );
}

if (!fromEmail) {
  throw new Error(
    "RESEND_FROM_EMAIL is not set. Add it to .env.local (see .env.example).",
  );
}

export const resend = new Resend(apiKey);

export const RESEND_FROM = fromEmail;
