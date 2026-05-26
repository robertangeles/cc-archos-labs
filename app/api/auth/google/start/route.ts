import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  buildAuthorizeUrl,
  getGoogleSigninConfig,
  GoogleSigninNotConfiguredError,
} from "../../../../../lib/auth/oauth-google";
import { getPublicOrigin } from "../../../../../lib/public-origin";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// GET /api/auth/google/start
// Redirects the user to Google's authorize endpoint. Sets a short-lived
// httpOnly cookie carrying the same state value embedded in the URL.
// The callback compares the two as CSRF defense.
//
// If Google sign-in isn't configured (no GOOGLE_SIGNIN_CLIENT_ID env),
// returns 404 — feature looks the same as if it didn't exist. Don't
// leak the misconfiguration via 500.

export const STATE_COOKIE = "archos_google_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 min — limit
                                              // exposure on stalled flows.
const STARTS_PER_IP_PER_HOUR = 20;

export async function GET(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`google-start:ip:${ip}`, STARTS_PER_IP_PER_HOUR);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "Too many sign-in attempts. Try again later." },
      { status: 429 },
    );
  }

  const redirectUri = `${getPublicOrigin(request)}/api/auth/google/callback`;

  let config;
  try {
    config = await getGoogleSigninConfig(redirectUri);
  } catch (err) {
    if (err instanceof GoogleSigninNotConfiguredError) {
      // Don't leak that the feature exists in the codebase.
      return new Response("Not found", { status: 404 });
    }
    throw err;
  }

  // 32 random bytes hex — 256 bits of entropy is plenty for a CSRF
  // nonce. Same value goes in the cookie + the OAuth `state` param;
  // callback rejects unless they match.
  const state = randomBytes(32).toString("hex");

  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });

  const url = buildAuthorizeUrl({ config, state });
  return Response.redirect(url, 303);
}
