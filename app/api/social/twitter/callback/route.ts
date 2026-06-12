import { cookies } from "next/headers";
import { getCurrentUser } from "../../../../../lib/auth/current-user";
import {
  exchangeTwitterCode,
  getTwitterProfile,
  toSocialTokens,
  STATE_COOKIE,
  PKCE_COOKIE,
} from "../../../../../lib/social/twitter";
import { storeSocialTokens } from "../../../../../lib/social/token";
import { getPublicOrigin } from "../../../../../lib/public-origin";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// GET /api/social/twitter/callback?code=…&state=…
// Twitter redirects here after the user authorises (or denies) the app.
//
// Flow:
//   1. Validate state cookie matches state query param (CSRF defense)
//   2. Retrieve PKCE code verifier from cookie
//   3. Exchange code for tokens
//   4. Fetch Twitter profile (id + username)
//   5. Store encrypted tokens via lib/social/token.ts
//   6. Redirect to /account/social-accounts?oauth=success&platform=twitter
//
// On any failure: redirect to social-accounts page with error param.
// Never leak which step failed to the user.

const CALLBACKS_PER_IP_PER_HOUR = 30;

export async function GET(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(
    `twitter-callback:ip:${ip}`,
    CALLBACKS_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=twitter&reason=rate_limited");
  }

  // The user must be logged in. The session was established before they
  // clicked "Connect Twitter" — userId comes from the session, never
  // from the OAuth state param.
  const session = await getCurrentUser();
  if (!session) {
    return redirectTo(request, "/login?error=session_expired");
  }

  const { searchParams } = new URL(request.url);

  // Twitter sends error= when the user denies or something goes wrong.
  const twitterError = searchParams.get("error");
  if (twitterError) {
    await clearOAuthCookies();
    return redirectTo(request, "/account/social-accounts?oauth=cancelled&platform=twitter");
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    await clearOAuthCookies();
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=twitter&reason=invalid");
  }

  // CSRF defense: state cookie must equal the state query param.
  const store = await cookies();
  const cookieState = store.get(STATE_COOKIE)?.value;
  const cookiePkce = store.get(PKCE_COOKIE)?.value;
  await clearOAuthCookies();

  if (!cookieState || cookieState !== state) {
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=twitter&reason=state_mismatch");
  }

  if (!cookiePkce) {
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=twitter&reason=pkce_missing");
  }

  // Exchange authorization code for tokens.
  const tokenResponse = await exchangeTwitterCode(request, code, cookiePkce);
  if (!tokenResponse) {
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=twitter&reason=token_exchange");
  }

  // Fetch the user's Twitter profile to get id + username.
  const profile = await getTwitterProfile(tokenResponse.access_token);
  if (!profile) {
    return redirectTo(request, "/account/social-accounts?oauth=error&platform=twitter&reason=profile_fetch");
  }

  // Store encrypted tokens. Upserts if a previous connection exists.
  const tokens = toSocialTokens(tokenResponse, profile);
  await storeSocialTokens(session.user.id, "twitter", tokens);

  return redirectTo(request, "/account/social-accounts?oauth=success&platform=twitter");
}

async function clearOAuthCookies(): Promise<void> {
  const store = await cookies();
  store.delete(STATE_COOKIE);
  store.delete(PKCE_COOKIE);
}

function redirectTo(request: Request, path: string): Response {
  const origin = getPublicOrigin(request);
  return Response.redirect(`${origin}${path}`, 303);
}
