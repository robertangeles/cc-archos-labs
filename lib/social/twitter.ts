import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { getIntegrationConfig } from "../integration-config";
import { getPublicOrigin } from "../public-origin";
import type { SocialOAuthTokens } from "./types";

// Twitter/X OAuth 2.0 + PKCE service. Handles the full OAuth dance
// (auth URL → code exchange → token refresh) and the publish endpoint.
//
// Twitter requires PKCE (Proof Key for Code Exchange) on all OAuth 2.0
// flows. The code verifier is a random 32-byte value; the code challenge
// is its SHA-256 hash. Both travel as base64url strings.
//
// Token exchange and refresh use Basic auth with clientId:clientSecret.
// Twitter rotates BOTH access and refresh tokens on every refresh call —
// callers MUST store both new values.

const AUTH_ENDPOINT = "https://x.com/i/oauth2/authorize";
const TOKEN_ENDPOINT = "https://api.x.com/2/oauth2/token";
const USERS_ME_ENDPOINT = "https://api.x.com/2/users/me";
const TWEETS_ENDPOINT = "https://api.x.com/2/tweets";

const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

// Cookie names for the OAuth flow. Both are httpOnly, short-lived, and
// scoped to /api/social/twitter to avoid leaking to unrelated routes.
export const STATE_COOKIE = "social_twitter_state";
export const PKCE_COOKIE = "social_twitter_pkce";

export class TwitterNotConfiguredError extends Error {
  constructor() {
    super(
      "Twitter integration is not configured or not enabled. " +
        "Set twitterClientId, twitterClientSecret, and twitterEnabled " +
        "via the admin integrations panel.",
    );
  }
  override name = "TwitterNotConfiguredError";
}

/**
 * Generate a cryptographically random PKCE code verifier (32 bytes,
 * base64url-encoded). The verifier is stored in a cookie and sent
 * to Twitter during the token exchange.
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Derive the PKCE code challenge from the verifier using SHA-256.
 * Twitter requires `code_challenge_method=S256`.
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Build the Twitter OAuth 2.0 authorize URL. Caller must set the state
 * and PKCE cookies before redirecting.
 *
 * Throws TwitterNotConfiguredError if Twitter is not enabled or
 * credentials are missing.
 */
export async function getTwitterAuthUrl(
  request: Request,
  state: string,
  codeVerifier: string,
): Promise<string> {
  const config = await getIntegrationConfig();

  if (!config.twitterEnabled) {
    throw new TwitterNotConfiguredError();
  }
  if (!config.twitterClientId || !config.twitterClientSecret) {
    throw new TwitterNotConfiguredError();
  }

  const redirectUri = `${getPublicOrigin(request)}/api/social/twitter/callback`;
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.twitterClientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface TwitterTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/**
 * Exchange the authorization code for access + refresh tokens.
 * Returns null on any non-2xx response or unparseable body.
 */
export async function exchangeTwitterCode(
  request: Request,
  code: string,
  codeVerifier: string,
): Promise<TwitterTokenResponse | null> {
  const config = await getIntegrationConfig();
  if (!config.twitterClientId || !config.twitterClientSecret) {
    return null;
  }

  const redirectUri = `${getPublicOrigin(request)}/api/social/twitter/callback`;
  const basicAuth = Buffer.from(
    `${config.twitterClientId}:${config.twitterClientSecret}`,
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basicAuth}`,
      },
      body: body.toString(),
    });
  } catch (err) {
    console.error(
      "[social/twitter] token exchange network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[social/twitter] token exchange ${res.status}:`,
      text.slice(0, 200),
    );
    return null;
  }

  try {
    return (await res.json()) as TwitterTokenResponse;
  } catch {
    return null;
  }
}

/**
 * Refresh the Twitter access token. Twitter rotates BOTH the access
 * token and the refresh token on every call — callers MUST store both.
 * Returns null on failure.
 */
export async function refreshTwitterToken(
  refreshToken: string,
): Promise<TwitterTokenResponse | null> {
  const config = await getIntegrationConfig();
  if (!config.twitterClientId || !config.twitterClientSecret) {
    return null;
  }

  const basicAuth = Buffer.from(
    `${config.twitterClientId}:${config.twitterClientSecret}`,
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basicAuth}`,
      },
      body: body.toString(),
    });
  } catch (err) {
    console.error(
      "[social/twitter] token refresh network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[social/twitter] token refresh ${res.status}:`,
      text.slice(0, 200),
    );
    return null;
  }

  try {
    return (await res.json()) as TwitterTokenResponse;
  } catch {
    return null;
  }
}

export interface TwitterProfile {
  id: string;
  username: string;
}

/**
 * Fetch the authenticated user's Twitter profile (id + username).
 * Returns null on failure.
 */
export async function getTwitterProfile(
  accessToken: string,
): Promise<TwitterProfile | null> {
  let res: Response;
  try {
    res = await fetch(USERS_ME_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error(
      "[social/twitter] profile fetch network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!res.ok) return null;

  try {
    const json = (await res.json()) as { data?: TwitterProfile };
    if (!json.data?.id || !json.data?.username) return null;
    return json.data;
  } catch {
    return null;
  }
}

export interface TwitterPublishResult {
  id: string;
  text: string;
}

/**
 * Publish a tweet. Returns the tweet id + text on success, null on
 * failure. Content must be <= 280 characters (caller validates).
 */
export async function publishToTwitter(
  accessToken: string,
  content: string,
): Promise<TwitterPublishResult | null> {
  let res: Response;
  try {
    res = await fetch(TWEETS_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ text: content }),
    });
  } catch (err) {
    console.error(
      "[social/twitter] publish network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[social/twitter] publish ${res.status}:`,
      text.slice(0, 200),
    );
    return null;
  }

  try {
    const json = (await res.json()) as { data?: TwitterPublishResult };
    if (!json.data?.id) return null;
    return json.data;
  } catch {
    return null;
  }
}

/**
 * Convert a TwitterTokenResponse to the SocialOAuthTokens shape used
 * by the token storage layer.
 */
export function toSocialTokens(
  tokenResponse: TwitterTokenResponse,
  profile: TwitterProfile,
): SocialOAuthTokens {
  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
    accountId: profile.id,
    accountName: `@${profile.username}`,
  };
}
