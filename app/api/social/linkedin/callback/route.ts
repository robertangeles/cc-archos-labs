import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPublicOrigin } from "@/lib/public-origin";
import {
  getLinkedInConfig,
  exchangeLinkedInCode,
  getLinkedInProfile,
  LinkedInNotConfiguredError,
} from "@/lib/social/linkedin";
import { storeSocialTokens } from "@/lib/social/token";
import { clientIpFromRequest, rateLimit } from "@/lib/rate-limit";
import { STATE_COOKIE_NAME } from "../connect/route";

export const runtime = "nodejs";

// GET /api/social/linkedin/callback?code=...&state=...
// LinkedIn redirects here after the user authorizes (or cancels).
//
// Failure modes all redirect to /account/social-accounts?oauth=error&platform=linkedin
// with a reason param — never leak which step failed in a way an
// attacker could probe.
//
// Happy path: validate state + exchange code + get profile + store
// tokens + redirect to /account/social-accounts?oauth=success&platform=linkedin.

const CALLBACKS_PER_IP_PER_HOUR = 30;

export async function GET(request: Request) {
  const ip = clientIpFromRequest(request);

  const limit = rateLimit(
    `linkedin-callback:ip:${ip}`,
    CALLBACKS_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=linkedin&reason=rate_limited");
  }

  // Auth check — userId comes from the session, not the state param.
  const auth = await getCurrentUser();
  if (!auth) {
    await clearStateCookie();
    return redirectTo(request, "/login?error=auth_required");
  }

  const { searchParams } = new URL(request.url);

  // LinkedIn may report an error (user cancelled, etc.).
  const linkedinError = searchParams.get("error");
  if (linkedinError) {
    await clearStateCookie();
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=linkedin&reason=cancelled");
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    await clearStateCookie();
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=linkedin&reason=invalid");
  }

  // CSRF defense: state cookie must equal the state query param.
  const store = await cookies();
  const cookieState = store.get(STATE_COOKIE_NAME)?.value;
  await clearStateCookie();
  if (!cookieState || cookieState !== state) {
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=linkedin&reason=state_mismatch");
  }

  // Load LinkedIn credentials.
  let config;
  try {
    config = await getLinkedInConfig();
  } catch (err) {
    if (err instanceof LinkedInNotConfiguredError) {
      return new Response("Not found", { status: 404 });
    }
    throw err;
  }

  const redirectUri = `${getPublicOrigin(request)}/api/social/linkedin/callback`;

  // Exchange code for tokens.
  const tokenResponse = await exchangeLinkedInCode(
    code,
    redirectUri,
    config.clientId,
    config.clientSecret,
  );
  if (!tokenResponse) {
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=linkedin&reason=token_exchange_failed");
  }

  // Fetch LinkedIn profile to get the stable user ID and display name.
  const profile = await getLinkedInProfile(tokenResponse.access_token);
  if (!profile) {
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=linkedin&reason=profile_failed");
  }

  // Compute token expiry. LinkedIn access tokens default to 60 days
  // (5184000 seconds).
  const expiresAt = tokenResponse.expires_in
    ? new Date(Date.now() + tokenResponse.expires_in * 1000)
    : undefined;

  // Store the tokens (encrypted at rest via storeSocialTokens).
  await storeSocialTokens(auth.user.id, "linkedin", {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt,
    accountId: profile.sub,
    accountName: profile.name,
  });

  return redirectTo(request, "/account/social-accounts?oauth=success&platform=linkedin");
}

async function clearStateCookie(): Promise<void> {
  const store = await cookies();
  store.set(STATE_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/social/linkedin",
    maxAge: 0,
  });
}

function redirectTo(request: Request, path: string): Response {
  const origin = getPublicOrigin(request);
  return Response.redirect(`${origin}${path}`, 303);
}
