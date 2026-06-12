import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPublicOrigin } from "@/lib/public-origin";
import {
  getLinkedInConfig,
  getLinkedInAuthUrl,
  LinkedInNotConfiguredError,
} from "@/lib/social/linkedin";
import { STATE_COOKIE_MAX_AGE_SECONDS } from "@/lib/social/types";
import { clientIpFromRequest, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// GET /api/social/linkedin/connect
// Requires authentication. Redirects the user to LinkedIn's authorize
// endpoint. Sets a short-lived httpOnly cookie carrying the same state
// value embedded in the URL. The callback compares the two as CSRF
// defense.

const STATE_COOKIE_NAME = "social_linkedin_state";
const CONNECTS_PER_IP_PER_HOUR = 20;

export { STATE_COOKIE_NAME };

export async function GET(request: Request) {
  // Auth check — user must be logged in to connect a social account.
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  // Rate limit.
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(
    `linkedin-connect:ip:${ip}`,
    CONNECTS_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many connection attempts. Try again later." },
      { status: 429 },
    );
  }

  // Load LinkedIn credentials — returns 404 if not configured so the
  // feature looks absent rather than misconfigured.
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

  // 16 random bytes base64url — 128 bits of entropy for the CSRF nonce.
  const state = randomBytes(16).toString("base64url");

  const store = await cookies();
  store.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/social/linkedin",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });

  const url = getLinkedInAuthUrl(state, redirectUri, config.clientId);
  return Response.redirect(url, 303);
}
