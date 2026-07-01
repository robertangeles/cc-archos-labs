import "server-only";

import { getIntegrationConfig } from "@/lib/integration-config";

// LinkedIn OAuth 2.0 — standard authorization code flow (no PKCE).
// Purpose: connect a user's LinkedIn account for publishing content.
//
// Env/DB fields used:
//   linkedinClientId     — from integration config (DB or env)
//   linkedinClientSecret — from integration config (DB or env)
//   linkedinEnabled      — gate flag; must be true for connect to work

const AUTH_ENDPOINT = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_ENDPOINT = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_ENDPOINT = "https://api.linkedin.com/v2/userinfo";
const POSTS_ENDPOINT = "https://api.linkedin.com/rest/posts";

const LINKEDIN_SCOPES = ["openid", "profile", "w_member_social"];

// LinkedIn API version header required by the REST API (format: YYYYMM).
// LinkedIn sunsets each monthly version after ~12 months, so this must be
// kept current. Override via the LINKEDIN_API_VERSION env var to bump it
// without a code change; the default tracks the latest active version.
// See https://learn.microsoft.com/en-us/linkedin/marketing/versioning
const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION ?? "202606";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export class LinkedInNotConfiguredError extends Error {
  constructor(
    message = "LinkedIn integration is not configured or is disabled",
  ) {
    super(message);
  }
  override name = "LinkedInNotConfiguredError";
}

interface LinkedInOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Read LinkedIn client credentials from integration config (DB-first,
 * env fallback). Throws LinkedInNotConfiguredError if the feature is
 * disabled or credentials are missing.
 */
export async function getLinkedInConfig(): Promise<LinkedInOAuthConfig> {
  const ic = await getIntegrationConfig();
  if (!ic.linkedinEnabled) {
    throw new LinkedInNotConfiguredError();
  }
  if (!ic.linkedinClientId || !ic.linkedinClientSecret) {
    throw new LinkedInNotConfiguredError(
      "LinkedIn client ID or secret is missing",
    );
  }
  return {
    clientId: ic.linkedinClientId,
    clientSecret: ic.linkedinClientSecret,
  };
}

// ---------------------------------------------------------------------------
// Auth URL
// ---------------------------------------------------------------------------

/**
 * Build the LinkedIn authorize URL the user is redirected to. The
 * caller MUST set a matching state cookie before issuing the redirect;
 * the callback compares the two as CSRF defense.
 */
export function getLinkedInAuthUrl(
  state: string,
  redirectUri: string,
  clientId: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

/**
 * Exchange the authorization code returned by LinkedIn for tokens.
 * Returns null on any failure (network error, non-2xx response, or
 * unparseable body).
 */
export async function exchangeLinkedInCode(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<LinkedInTokenResponse | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    console.error(
      "[social/linkedin] token exchange network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[social/linkedin] token exchange ${res.status}:`,
      text.slice(0, 200),
    );
    return null;
  }

  try {
    return (await res.json()) as LinkedInTokenResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Refresh an expired LinkedIn access token using the refresh token.
 * Returns null on failure.
 */
export async function refreshLinkedInToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<LinkedInTokenResponse | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    console.error(
      "[social/linkedin] token refresh network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[social/linkedin] token refresh ${res.status}:`,
      text.slice(0, 200),
    );
    return null;
  }

  try {
    return (await res.json()) as LinkedInTokenResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

interface LinkedInProfile {
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
}

/**
 * Fetch the authenticated user's LinkedIn profile (sub + name).
 * Returns null on failure.
 */
export async function getLinkedInProfile(
  accessToken: string,
): Promise<LinkedInProfile | null> {
  let res: Response;
  try {
    res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error(
      "[social/linkedin] profile fetch network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[social/linkedin] profile fetch ${res.status}:`,
      text.slice(0, 200),
    );
    return null;
  }

  try {
    return (await res.json()) as LinkedInProfile;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

interface LinkedInPublishResult {
  id: string;
}

/**
 * Publish a text post to the authenticated user's LinkedIn feed.
 * Returns the share URN on success, null on failure.
 */
export async function publishToLinkedIn(
  accessToken: string,
  accountId: string,
  content: string,
): Promise<string | null> {
  const payload = {
    author: `urn:li:person:${accountId}`,
    lifecycleState: "PUBLISHED",
    visibility: "PUBLIC",
    commentary: content,
    distribution: {
      feedDistribution: "MAIN_FEED",
    },
  };

  let res: Response;
  try {
    res = await fetch(POSTS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": LINKEDIN_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(
      "[social/linkedin] publish network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[social/linkedin] publish ${res.status}:`,
      text.slice(0, 200),
    );
    return null;
  }

  // A successful create returns 201 with the post URN in the `x-restli-id`
  // response header — the body is typically empty, so do NOT rely on
  // res.json(). Read the header first; fall back to a body `id` only if the
  // header is absent (defensive — the documented contract is header-only).
  const urnFromHeader = res.headers.get("x-restli-id");
  if (urnFromHeader) return urnFromHeader;

  try {
    const data = (await res.json()) as LinkedInPublishResult;
    return data.id ?? null;
  } catch {
    return null;
  }
}
