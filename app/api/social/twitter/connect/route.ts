import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "../../../../../lib/auth/current-user";
import {
  getTwitterAuthUrl,
  generateCodeVerifier,
  TwitterNotConfiguredError,
  STATE_COOKIE,
  PKCE_COOKIE,
} from "../../../../../lib/social/twitter";
import { STATE_COOKIE_MAX_AGE_SECONDS } from "../../../../../lib/social/types";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";

export const runtime = "nodejs";

// GET /api/social/twitter/connect
// Redirects the authenticated user to Twitter's OAuth 2.0 authorize
// endpoint. Sets two httpOnly cookies: state (CSRF defense) and PKCE
// code verifier (required by Twitter's OAuth 2.0 flow).
//
// Requires an active session — unauthenticated requests get 401.
// Returns 404 if Twitter integration is not configured (don't leak
// the existence of the feature).

const CONNECTS_PER_IP_PER_HOUR = 20;

export async function GET(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`twitter-connect:ip:${ip}`, CONNECTS_PER_IP_PER_HOUR);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

  const session = await getCurrentUser();
  if (!session) {
    return Response.json(
      { ok: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  const state = randomBytes(16).toString("base64url");
  const codeVerifier = generateCodeVerifier();

  let authUrl: string;
  try {
    authUrl = await getTwitterAuthUrl(request, state, codeVerifier);
  } catch (err) {
    if (err instanceof TwitterNotConfiguredError) {
      return new Response("Not found", { status: 404 });
    }
    throw err;
  }

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/social/twitter",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  };

  const store = await cookies();
  store.set(STATE_COOKIE, state, cookieOptions);
  store.set(PKCE_COOKIE, codeVerifier, cookieOptions);

  return Response.redirect(authUrl, 303);
}
