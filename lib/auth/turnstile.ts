import "server-only";

// Cloudflare Turnstile server-side verification.
//
// Feature-flagged via env for T6 — flip ON by setting:
//   TURNSTILE_ENABLED=true
//   TURNSTILE_SECRET_KEY=<from Cloudflare dashboard>
//
// (TURNSTILE_SITE_KEY lives in the future T8 admin UI / a NEXT_PUBLIC_
// env var so the frontend widget can render with it.)
//
// When T8 ships the admin UI, this helper will switch to a DB-first /
// env-fallback pattern reading auth_setting (matches lib/resend.ts shape).
// For T6 we keep it env-only — admin UI doesn't exist yet to write the
// DB rows, so reading the DB would always fall through anyway.
//
// Default posture: OFF. Routes call `requireTurnstile` and it returns
// `{ ok: true }` when the feature flag is unset — no Turnstile token
// required, no Cloudflare round-trip. This matches plan §9: "Default
// turnstile_enabled = false. Plumbed end-to-end so flipping the toggle
// is the only step needed to activate."

const VERIFY_ENDPOINT =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerifyResult {
  /** True if the token verifies OR the feature is disabled. */
  ok: boolean;
  /** Populated on failure. Empty on bypass / success. */
  errorCodes: string[];
  /** True when the feature flag is OFF (we never called Cloudflare). */
  bypassed: boolean;
}

/**
 * Returns true if Turnstile verification is configured + active. False
 * if either the enable flag is missing OR the secret key is missing.
 * Routes call this only when they need to render the frontend widget
 * differently (e.g. show or hide the Turnstile challenge); the verify
 * step uses `requireTurnstile` which calls this internally.
 */
export function isTurnstileEnabled(): boolean {
  const enabled = process.env.TURNSTILE_ENABLED;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || secret.length === 0) return false;
  if (enabled !== "true" && enabled !== "1") return false;
  return true;
}

/**
 * Verify a Turnstile token against Cloudflare. Used by `requireTurnstile`
 * internally; exported for use by the future T8 admin "test this key"
 * action. Returns a structured result — never throws.
 */
export async function verifyTurnstileToken(opts: {
  token: string;
  remoteIp?: string | null;
}): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return { ok: false, errorCodes: ["missing-secret"], bypassed: false };
  }
  if (typeof opts.token !== "string" || opts.token.length === 0) {
    return { ok: false, errorCodes: ["missing-token"], bypassed: false };
  }

  const body = new URLSearchParams({
    secret,
    response: opts.token,
  });
  if (opts.remoteIp) body.set("remoteip", opts.remoteIp);

  let res: Response;
  try {
    res = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    console.error(
      "[auth/turnstile] verify network error:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, errorCodes: ["network-error"], bypassed: false };
  }

  if (!res.ok) {
    return {
      ok: false,
      errorCodes: [`http-${res.status}`],
      bypassed: false,
    };
  }

  let parsed: { success?: boolean; "error-codes"?: string[] };
  try {
    parsed = (await res.json()) as typeof parsed;
  } catch {
    return {
      ok: false,
      errorCodes: ["malformed-response"],
      bypassed: false,
    };
  }

  if (parsed.success === true) {
    return { ok: true, errorCodes: [], bypassed: false };
  }
  return {
    ok: false,
    errorCodes: parsed["error-codes"] ?? ["unknown"],
    bypassed: false,
  };
}

/**
 * Single call-site for routes that protect themselves with Turnstile.
 * Returns `{ ok: true, bypassed: true }` when the feature flag is OFF
 * — caller proceeds with the request normally.
 *
 * When the flag is ON:
 *   - missing token  → { ok: false, errorCodes: ['missing-token'] }
 *   - verify failure → { ok: false, errorCodes: [...] }
 *   - verify success → { ok: true, bypassed: false }
 *
 * Usage:
 *
 *   const tsResult = await requireTurnstile({
 *     token: body.turnstileToken,
 *     remoteIp: clientIpFromRequest(request),
 *   });
 *   if (!tsResult.ok) {
 *     return Response.json(
 *       { ok: false, error: "Bot check failed. Please try again." },
 *       { status: 400 },
 *     );
 *   }
 */
export async function requireTurnstile(opts: {
  token?: string | null;
  remoteIp?: string | null;
}): Promise<TurnstileVerifyResult> {
  if (!isTurnstileEnabled()) {
    return { ok: true, errorCodes: [], bypassed: true };
  }
  return verifyTurnstileToken({
    token: opts.token ?? "",
    remoteIp: opts.remoteIp ?? null,
  });
}
