import { NextResponse } from "next/server";
import {
  BookingError,
  GoogleAuthError,
} from "../../../../../lib/errors/booking";
import { generateAuthUrl, generateState } from "../../../../../lib/google-oauth";

// GET /api/admin/google-oauth/start
//
// Mints a CSRF nonce, stashes it in an HttpOnly cookie, and redirects to
// Google's consent screen. The callback at /cb compares the URL `state`
// param to the cookie before exchanging the code — this is the only
// thing standing between us and an attacker tricking Rob into granting
// a Calendar token to a malicious app (plan §3 threat model).
//
// Auth: proxy.ts gates /api/admin/** with the admin session JWT.

export const runtime = "nodejs";

export const STATE_COOKIE = "google_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 min — generous for slow consent

export async function GET() {
  let authUrl: string;
  let state: string;
  try {
    state = generateState();
    authUrl = generateAuthUrl({ state });
  } catch (err) {
    // Surface config issues (missing GOOGLE_OAUTH_* env vars) as a clear
    // 500 with the remediation hint baked into BookingError.
    const message =
      err instanceof BookingError || err instanceof GoogleAuthError
        ? err.message
        : "Could not start Google OAuth flow.";
    console.error("[google-oauth/start] failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // Lax — top-level navigation back from Google must include the cookie
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin/google-oauth",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
