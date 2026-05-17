import "server-only";

// Google OAuth 2.0 helpers for the Book-a-Call admin grant flow.
//
// The flow is single-consultant for v1 (only Rob has a Google Calendar
// integration): Rob hits /admin/connect-google once, grants the app
// `calendar.events` scope, the callback exchanges the auth code for a
// refresh token + access token, and the refresh token is encrypted via
// lib/booking-crypto.ts and stored on consultant.google_refresh_token_encrypted.
//
// From then on, lib/google-calendar.ts decrypts the refresh token,
// trades it for a fresh access token (cached in-memory, ~50 min TTL),
// and uses it to call freebusy / events.insert / events.delete.
//
// This module is pure HTTP + URL building. No DB, no crypto, no caching
// — those concerns live elsewhere so we can unit-test the OAuth
// mechanics in isolation.

import { randomBytes } from "node:crypto";
import {
  BookingError,
  GoogleAuthError,
  GoogleAuthErrorRevoked,
} from "./errors/booking";
import { getIntegrationConfig } from "./integration-config";

// Narrowest scope set that covers everything we need:
//   - calendar.events   → events.insert (with Meet conferenceData),
//                         events.delete, events.get
//   - calendar.freebusy → freebusy.query (read busy intervals across
//                         the consultant's primary calendar)
// Broader `calendar` scope would also work but grants strictly more
// than needed. Google docs confirm freebusy is gated separately from
// events: https://developers.google.com/calendar/api/auth
export const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// ----------------------------------------------------------------------------
// Config — Client ID/Secret in DB-backed Settings; Redirect URI in env
// ----------------------------------------------------------------------------
//
// Why split: Client ID + Secret are stable across environments and only
// rotated rarely — they live in integration_secrets (encrypted at rest)
// so the same audit/rotation discipline as Resend/LLM keys applies, and
// they never sit in a .env file at risk of accidental commit.
//
// Redirect URI is genuinely environment-specific (localhost vs prod URL)
// so it remains a plain env var — textbook env-var territory.

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Reads config at call time (not module load) so tests can stub the
// integration-config layer per-suite. Throws BookingError with a
// remediation hint when anything is missing — surfaces config errors
// loudly.
export async function getOAuthConfig(): Promise<OAuthConfig> {
  const config = await getIntegrationConfig();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!config.googleOauthClientId || !config.googleOauthClientSecret) {
    throw new BookingError(
      "Google OAuth not configured. Set Client ID and Client Secret in /admin/integrations.",
    );
  }
  if (!redirectUri) {
    throw new BookingError(
      "GOOGLE_OAUTH_REDIRECT_URI is not set. Add it to .env.local (dev) and Render env (prod) — it is environment-specific so it stays in env, not Settings.",
    );
  }

  return {
    clientId: config.googleOauthClientId,
    clientSecret: config.googleOauthClientSecret,
    redirectUri,
  };
}

// ----------------------------------------------------------------------------
// generateAuthUrl — builds the consent URL the admin starts the grant from
// ----------------------------------------------------------------------------
//
// `state` is a CSRF nonce the caller stores in an HttpOnly cookie and
// validates on the callback. Plan §3 threat model — state binding is
// the only thing standing between us and an attacker tricking Rob into
// granting a Calendar token for a malicious app.
//
// `access_type=offline` + `prompt=consent` together are what get Google
// to issue a refresh token (without consent prompt, an existing grant
// returns ONLY an access token). We need the refresh token to call
// Calendar API after Rob closes the browser.
//
// `include_granted_scopes=true` keeps prior grants intact if Rob has
// connected the app to other Google services in the same project.

export interface GenerateAuthUrlInput {
  state: string;
}

export async function generateAuthUrl(
  input: GenerateAuthUrlInput,
): Promise<string> {
  const { clientId, redirectUri } = await getOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: REQUIRED_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: input.state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ----------------------------------------------------------------------------
// exchangeCodeForTokens — server-side authorization code exchange
// ----------------------------------------------------------------------------
//
// Called from /api/admin/google-oauth/cb after Google redirects with
// ?code=... The route validates `state`, then calls this to swap the
// code for tokens. The refresh token is the keep-forever credential
// (encrypt + store); the access token is short-lived (cache in memory).

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  // Unix seconds at which the access token expires.
  expiresAt: number;
  // Space-separated scopes Google actually granted (usually matches
  // REQUIRED_SCOPES but Google can grant less if the user un-checks
  // an item on the consent screen).
  scope: string;
  tokenType: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokens> {
  const config = await getOAuthConfig();
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!response.ok || json.error) {
    throw new GoogleAuthError(
      `Google token exchange failed (${response.status}): ${json.error_description ?? json.error ?? response.statusText}`,
    );
  }

  if (!json.refresh_token) {
    // Without a refresh token we can't do anything useful — Google
    // only issues one if access_type=offline + prompt=consent are set
    // AND the user hasn't recently completed the same consent flow.
    // Surface this loudly so the admin can re-grant with the right
    // params.
    throw new GoogleAuthError(
      "Google returned an access token but no refresh token. Re-grant with access_type=offline and prompt=consent.",
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
    scope: json.scope,
    tokenType: json.token_type,
  };
}

// ----------------------------------------------------------------------------
// refreshAccessToken — trade a refresh token for a fresh access token
// ----------------------------------------------------------------------------
//
// Called by lib/google-calendar.ts whenever its cached access token has
// expired (or is about to — we use a 5-min skew per the plan §18.1 token
// refresh strategy decision). On 400/401 we throw GoogleAuthErrorRevoked
// so the caller can mark consultant.google_status='stale' and alert.

export interface RefreshedAccessToken {
  accessToken: string;
  expiresAt: number;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<RefreshedAccessToken> {
  const config = await getOAuthConfig();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!response.ok || json.error) {
    // 400 with error=invalid_grant means the user revoked the app
    // (or their Google password changed / their account was
    // suspended). Distinguish so the caller can prompt re-auth.
    const isRevoked =
      json.error === "invalid_grant" || response.status === 400;
    const message = `Google token refresh failed (${response.status}): ${json.error_description ?? json.error ?? response.statusText}`;
    throw isRevoked
      ? new GoogleAuthErrorRevoked(message)
      : new GoogleAuthError(message);
  }

  return {
    accessToken: json.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

// ----------------------------------------------------------------------------
// generateState — cryptographically random CSRF nonce
// ----------------------------------------------------------------------------
//
// Used by the /api/admin/google-oauth/start route to mint the cookie
// value + URL state. Verifying state on the callback prevents a
// malicious site from tricking Rob into granting a token to an
// attacker-controlled redirect.

export function generateState(): string {
  return randomBytes(16).toString("base64url");
}
