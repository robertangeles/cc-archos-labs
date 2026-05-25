import "server-only";
import { getAuthSettings, getTurnstileSecretPlain } from "./settings";

// Cloudflare Turnstile server-side verification.
//
// T8 — config is DB-first (auth_setting) with env-var fallback. Admins
// flip the toggle + paste the secret in /admin/auth; the helper reads
// from DB on every requireTurnstile() call. If the DB row is unset, the
// helper falls back to env vars (TURNSTILE_ENABLED, TURNSTILE_SECRET_KEY)
// so the T6 env-only path keeps working through the transition.
//
// Resolution order:
//   1. auth_setting.turnstile_enabled true + secret available (DB or env)
//        → enabled, verify with the DB secret if present else env
//   2. env TURNSTILE_ENABLED=true + TURNSTILE_SECRET_KEY set
//        → enabled, verify with env secret
//   3. else
//        → bypassed (no Cloudflare round-trip, no token required)
//
// Default posture: OFF. Flipping the admin toggle is the only step
// needed to activate (assuming a secret is also stored).

const VERIFY_ENDPOINT =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface EffectiveTurnstileConfig {
  enabled: boolean;
  /** Plaintext secret, or null if unavailable. */
  secret: string | null;
}

/**
 * Resolve current Turnstile config from DB first, env fallback. Used
 * internally by isTurnstileEnabled + verify + requireTurnstile so all
 * three see the same effective state.
 */
async function getEffectiveTurnstileConfig(): Promise<EffectiveTurnstileConfig> {
  // 1. Try DB.
  try {
    const settings = await getAuthSettings();
    if (settings.turnstileEnabled) {
      const dbSecret = settings.turnstileHasSecret
        ? await getTurnstileSecretPlain()
        : null;
      const envSecret = process.env.TURNSTILE_SECRET_KEY ?? null;
      const secret = dbSecret || envSecret || null;
      return { enabled: secret !== null, secret };
    }
  } catch (err) {
    // DB unreachable → silently fall through to env path.
    console.error(
      "[auth/turnstile] auth_setting read failed; falling back to env:",
      err instanceof Error ? err.message : String(err),
    );
  }
  // 2. Env fallback.
  const envEnabled =
    process.env.TURNSTILE_ENABLED === "true" ||
    process.env.TURNSTILE_ENABLED === "1";
  const envSecret = process.env.TURNSTILE_SECRET_KEY ?? null;
  if (envEnabled && envSecret) {
    return { enabled: true, secret: envSecret };
  }
  return { enabled: false, secret: null };
}

export interface TurnstileVerifyResult {
  /** True if the token verifies OR the feature is disabled. */
  ok: boolean;
  /** Populated on failure. Empty on bypass / success. */
  errorCodes: string[];
  /** True when the feature flag is OFF (we never called Cloudflare). */
  bypassed: boolean;
}

/**
 * Returns true if Turnstile verification is configured + active.
 * Reads the effective config from DB (auth_setting) with env fallback.
 */
export async function isTurnstileEnabled(): Promise<boolean> {
  const config = await getEffectiveTurnstileConfig();
  return config.enabled;
}

/**
 * Verify a Turnstile token against Cloudflare. Used by `requireTurnstile`
 * internally; exported for use by the future T8 admin "test this key"
 * action. Returns a structured result — never throws.
 *
 * If a `secret` arg is provided, uses it directly (lets the admin
 * "test this secret" UI verify against a value the user just pasted
 * before saving). Otherwise resolves from DB/env.
 */
export async function verifyTurnstileToken(opts: {
  token: string;
  remoteIp?: string | null;
  /** Optional override. When unset, resolves from DB/env. */
  secret?: string;
}): Promise<TurnstileVerifyResult> {
  let secret = opts.secret;
  if (!secret) {
    const config = await getEffectiveTurnstileConfig();
    secret = config.secret ?? undefined;
  }
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
  const config = await getEffectiveTurnstileConfig();
  if (!config.enabled) {
    return { ok: true, errorCodes: [], bypassed: true };
  }
  return verifyTurnstileToken({
    token: opts.token ?? "",
    remoteIp: opts.remoteIp ?? null,
    secret: config.secret ?? undefined,
  });
}
