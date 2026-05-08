import { Resend } from "resend";

// Server-only Resend client. Never imported into client components.
//
// Validation runs lazily on first call, not at module load. Validating
// at import time would crash any build (or any unrelated module evaluation)
// in environments where RESEND_API_KEY / RESEND_FROM_EMAIL aren't set —
// including the Next.js production build on Render before env vars are
// wired up. This getter defers the check to the request that actually
// wants to send mail.

let cachedClient: Resend | null = null;

export function getResend(): { resend: Resend; from: string } {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. Add it to .env.local (see .env.example) " +
        "or to the Render service env vars in production.",
    );
  }
  if (!fromEmail) {
    throw new Error(
      "RESEND_FROM_EMAIL is not set. Add it to .env.local (see .env.example) " +
        "or to the Render service env vars in production.",
    );
  }

  if (!cachedClient) {
    cachedClient = new Resend(apiKey);
  }

  return { resend: cachedClient, from: fromEmail };
}
