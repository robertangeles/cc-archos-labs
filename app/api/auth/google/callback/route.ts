import { cookies } from "next/headers";
import {
  exchangeCodeForToken,
  fetchGoogleUserinfo,
  getGoogleSigninConfig,
  GoogleSigninNotConfiguredError,
  linkOrCreateUserFromGoogle,
  issueSessionForGoogleUser,
} from "../../../../../lib/auth/oauth-google";
import { setSessionCookie } from "../../../../../lib/auth/cookies";
import { logAuthEvent } from "../../../../../lib/auth/audit";
import { getPublicOrigin } from "../../../../../lib/public-origin";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";
import { STATE_COOKIE } from "../start/route";

export const runtime = "nodejs";

// GET /api/auth/google/callback?code=…&state=…
// Google redirects here after the user clicks "Allow" (or "Cancel").
//
// Failure modes (all redirect to /sign-in?error=… — never leak which
// step failed in a way an attacker could probe):
//   1. Google reported error= in query (user clicked Cancel, etc.)
//   2. state cookie missing OR doesn't match state query param
//   3. Configuration missing (env not set)
//   4. Token exchange fails (bad code, expired code, network)
//   5. userinfo fetch fails OR returns email_verified !== true
//   6. linkOrCreateUserFromGoogle throws (e.g. deactivated user)
//
// Happy path: link or create user, issue session, set cookie, log
// auth_event{login_oauth}, redirect to /account?signed_in=1.
//
// No CSRF check — the state-cookie comparison IS the CSRF defense for
// this leg of the OAuth dance.

const CALLBACKS_PER_IP_PER_HOUR = 30;

export async function GET(request: Request) {
  const ip = clientIpFromRequest(request);
  const userAgent = request.headers.get("user-agent");

  const limit = rateLimit(
    `google-callback:ip:${ip}`,
    CALLBACKS_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return redirectTo(request, "/sign-in?error=rate_limited");
  }

  const { searchParams } = new URL(request.url);
  const googleError = searchParams.get("error");
  if (googleError) {
    // User cancelled OR Google rejected the grant.
    await clearStateCookie();
    return redirectTo(request, "/sign-in?error=oauth_cancelled");
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    await clearStateCookie();
    return redirectTo(request, "/sign-in?error=oauth_invalid");
  }

  // CSRF defense: state cookie must equal the state query param.
  const store = await cookies();
  const cookieState = store.get(STATE_COOKIE)?.value;
  await clearStateCookie();
  if (!cookieState || cookieState !== state) {
    return redirectTo(request, "/sign-in?error=oauth_state_mismatch");
  }

  const redirectUri = `${getPublicOrigin(request)}/api/auth/google/callback`;

  let config;
  try {
    config = getGoogleSigninConfig(redirectUri);
  } catch (err) {
    if (err instanceof GoogleSigninNotConfiguredError) {
      return new Response("Not found", { status: 404 });
    }
    throw err;
  }

  const token = await exchangeCodeForToken({ config, code });
  if (!token) {
    return redirectTo(request, "/sign-in?error=oauth_token_exchange_failed");
  }

  const userinfo = await fetchGoogleUserinfo(token.access_token);
  if (!userinfo) {
    return redirectTo(request, "/sign-in?error=oauth_userinfo_failed");
  }

  // CRITICAL: refuse unverified Google emails. Google Workspace can
  // emit email_verified=false for some accounts; we never trust those.
  if (userinfo.email_verified !== true) {
    await logAuthEvent({
      userId: null,
      eventType: "login_failed",
      ipAddress: ip || null,
      userAgent,
      metadata: {
        provider: "google",
        reason: "google_email_unverified",
        normalizedEmail: userinfo.email.toLowerCase(),
      },
    });
    return redirectTo(request, "/sign-in?error=oauth_email_unverified");
  }

  let result;
  try {
    result = await linkOrCreateUserFromGoogle(userinfo);
  } catch (err) {
    // Deactivated user OR DB hiccup. Don't reveal which.
    console.error(
      "[/api/auth/google/callback] link-or-create failed:",
      err instanceof Error ? err.message : String(err),
    );
    return redirectTo(request, "/sign-in?error=oauth_account_unavailable");
  }

  const session = await issueSessionForGoogleUser({
    userId: result.userId,
    ipAddress: ip || null,
    userAgent,
  });
  await setSessionCookie(session.cookieValue);

  await logAuthEvent({
    userId: result.userId,
    eventType: result.newlyLinked ? "oauth_linked" : "login_oauth",
    ipAddress: ip || null,
    userAgent,
    metadata: {
      provider: "google",
      newlyCreated: result.newlyCreated,
      newlyLinked: result.newlyLinked,
    },
  });

  return redirectTo(request, "/account?signed_in=1");
}

async function clearStateCookie(): Promise<void> {
  const store = await cookies();
  store.delete(STATE_COOKIE);
}

function redirectTo(request: Request, path: string): Response {
  const origin = getPublicOrigin(request);
  return Response.redirect(`${origin}${path}`, 303);
}
