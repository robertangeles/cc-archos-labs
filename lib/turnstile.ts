import "server-only";

// Cloudflare Turnstile server-side verification.
//
// The form embeds the Turnstile widget client-side via the site key.
// On submit the widget produces a token; the server posts it (plus the
// secret key + originating IP) to Cloudflare's siteverify endpoint
// which returns success/false.
//
// This module is intentionally tiny: one function, one network call,
// typed errors. The booking route narrows on the named errors to decide
// "show a friendly 'try again' message" vs "log and 500."
//
// When Turnstile isn't configured (secret key null in Settings), the
// route layer skips this check entirely — gives us a soft-launch path
// where the booking form works without bot protection while we register
// a widget. Booking-create surfaces the missing-config state in its
// own error path; this module just throws TurnstileError when called
// without a secret.

import { getIntegrationConfig } from "./integration-config";
import { TurnstileError } from "./errors/booking";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface VerifyTurnstileInput {
  token: string;
  remoteIp?: string;
}

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

// Returns true if Turnstile passed, throws TurnstileError otherwise.
// The route handler turns the error into a 400 with a non-leaky message;
// the failure mode is the user must retry (refresh + resubmit).
export async function verifyTurnstile(
  input: VerifyTurnstileInput,
): Promise<true> {
  const config = await getIntegrationConfig();
  const secret = config.turnstileSecretKey;
  if (!secret) {
    throw new TurnstileError(
      "Turnstile not configured — set the Secret key in /admin/integrations/anti-spam.",
    );
  }

  const body = new URLSearchParams({ secret, response: input.token });
  if (input.remoteIp) {
    body.set("remoteip", input.remoteIp);
  }

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    // Cloudflare unreachable — fail closed. The booking-create handler
    // returns 503 so the client retries.
    throw new TurnstileError(
      `Cloudflare siteverify unreachable: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  let json: SiteverifyResponse;
  try {
    json = (await response.json()) as SiteverifyResponse;
  } catch {
    throw new TurnstileError(
      `Cloudflare siteverify returned non-JSON (${response.status})`,
    );
  }

  if (!json.success) {
    const codes = (json["error-codes"] ?? []).join(", ") || "unknown";
    throw new TurnstileError(`Turnstile verification failed: ${codes}`);
  }

  return true;
}

// Returns true if Turnstile is *fully* configured — BOTH site key
// (needed for the widget to render client-side) AND secret key (needed
// for server-side verification). Half-configured state is treated as
// "not configured" so we never reject a submission that the form
// couldn't have generated a token for.
export async function isTurnstileConfigured(): Promise<boolean> {
  const config = await getIntegrationConfig();
  return Boolean(config.turnstileSiteKey && config.turnstileSecretKey);
}
