import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { oauthAccount, users } from "../db/schema";
import { issueSession } from "./session";
import { getAuthSettings, getGoogleClientSecretPlain } from "./settings";

// Google OAuth 2.0 helpers for SIGN-IN. Distinct from the existing
// booking Calendar OAuth (lib/google-oauth.ts):
//
//   This module                       Booking module
//   ─────────────                     ──────────────
//   Purpose: sign-in                  Purpose: Calendar API access
//   Scopes:  openid email profile     Scopes:  calendar.events + freebusy
//   Tokens:  NOT stored               Tokens:  refresh_token stored encrypted
//   Env:     GOOGLE_SIGNIN_*          Env:     GOOGLE_OAUTH_*
//   Surface: /api/auth/google/*       Surface: /api/admin/google-oauth/*
//
// Both are valid Google Cloud OAuth clients — the admin creates two
// separate Web Application credentials in Google Cloud Console with
// different authorized redirect URIs.
//
// Config source: DB-first (auth_setting via admin UI) with env-var
// fallback (GOOGLE_SIGNIN_CLIENT_ID + GOOGLE_SIGNIN_CLIENT_SECRET).
// Admin can flip Google sign-in at /admin/auth (T8b); env vars remain
// the pre-admin-UI deployment path and the disaster-recovery override.
//
// Resolution order:
//   1. auth_setting.google_oauth_enabled true + DB has client id +
//      DB has decryptable client secret → use DB values
//   2. env GOOGLE_SIGNIN_CLIENT_ID + GOOGLE_SIGNIN_CLIENT_SECRET set
//      → use env values
//   3. else → throw GoogleSigninNotConfiguredError (route returns 404
//      so the feature looks absent rather than misconfigured)

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

const SIGNIN_SCOPES = ["openid", "email", "profile"];

export interface OAuthSigninConfig {
  clientId: string;
  clientSecret: string;
  /** Built per-request from getPublicOrigin so dev / prod both work. */
  redirectUri: string;
}

export class GoogleSigninNotConfiguredError extends Error {
  constructor() {
    super(
      "Google sign-in is not configured. Set GOOGLE_SIGNIN_CLIENT_ID and " +
        "GOOGLE_SIGNIN_CLIENT_SECRET in .env.local (dev) and the Render env " +
        "(prod). Use a SEPARATE Google Cloud OAuth client from the booking " +
        "Calendar integration — different scopes, different redirect URI.",
    );
  }
  override name = "GoogleSigninNotConfiguredError";
}

/**
 * Read config DB-first with env fallback. Throws
 * GoogleSigninNotConfiguredError if NEITHER path yields a complete
 * (clientId + clientSecret) pair — caller (the /api/auth/google/start
 * route) catches and returns 404 so the absence of configuration looks
 * the same as the feature being disabled.
 *
 * Why async: the DB path requires reading the auth_setting table. Sync
 * env-only is no longer sufficient now that the admin UI can override.
 */
export async function getGoogleSigninConfig(
  redirectUri: string,
): Promise<OAuthSigninConfig> {
  // 1. DB path. A DB read that throws (DB down) silently falls through
  // to env so the auth path isn't denied-of-service'd by a DB hiccup.
  try {
    const settings = await getAuthSettings();
    if (
      settings.googleOauthEnabled &&
      settings.googleClientId.length > 0 &&
      settings.googleHasClientSecret
    ) {
      const dbSecret = await getGoogleClientSecretPlain();
      if (dbSecret) {
        return {
          clientId: settings.googleClientId,
          clientSecret: dbSecret,
          redirectUri,
        };
      }
    }
  } catch (err) {
    console.error(
      "[auth/oauth-google] auth_setting read failed; falling back to env:",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 2. Integration config fallback — reuse the Google OAuth credentials
  // from /admin/integrations (same client ID + secret; different redirect
  // URI and scopes, which are set per-request not per-client).
  try {
    const { getIntegrationConfig } = await import("../integration-config");
    const ic = await getIntegrationConfig();
    if (ic.googleOauthClientId && ic.googleOauthClientSecret) {
      return {
        clientId: ic.googleOauthClientId,
        clientSecret: ic.googleOauthClientSecret,
        redirectUri,
      };
    }
  } catch {
    // Integration config unavailable — fall through to env.
  }

  // 3. Env fallback.
  const clientId = process.env.GOOGLE_SIGNIN_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SIGNIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleSigninNotConfiguredError();
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * Build the Google authorize URL the user is redirected to. The caller
 * MUST set a matching state cookie before issuing the redirect; the
 * callback compares the two as CSRF defense on the OAuth dance.
 *
 * No `access_type=offline` and no `prompt=consent` — we don't need a
 * refresh token for sign-in (no API calls to Google after auth). The
 * default flow returns an access token good for ~1 hour, which is all
 * we need to call /userinfo once and get the sub + email.
 */
export function buildAuthorizeUrl(opts: {
  config: OAuthSigninConfig;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.config.clientId,
    redirect_uri: opts.config.redirectUri,
    response_type: "code",
    scope: SIGNIN_SCOPES.join(" "),
    state: opts.state,
    // Force account chooser even if the user has a single Google
    // session — defeats the "I'm signed into the wrong Google account"
    // UX trap on devices shared across personal + work Google logins.
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

/**
 * Exchange the authorization code returned by Google for an access
 * token. Single use — the code is consumed by Google on first redeem.
 * Returns null on any non-2xx response or unparseable body.
 */
export async function exchangeCodeForToken(opts: {
  config: OAuthSigninConfig;
  code: string;
}): Promise<TokenResponse | null> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.config.clientId,
    client_secret: opts.config.clientSecret,
    redirect_uri: opts.config.redirectUri,
    grant_type: "authorization_code",
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
      "[auth/oauth-google] token exchange network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      `[auth/oauth-google] token exchange ${res.status}:`,
      text.slice(0, 200),
    );
    return null;
  }
  try {
    return (await res.json()) as TokenResponse;
  } catch {
    return null;
  }
}

export interface GoogleUserinfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

/**
 * Fetch the user's profile + email from the OIDC userinfo endpoint.
 * Returns null on non-2xx or unparseable JSON. Caller MUST check
 * `email_verified` — we reject any Google response that doesn't
 * confirm the email belongs to the user.
 */
export async function fetchGoogleUserinfo(
  accessToken: string,
): Promise<GoogleUserinfo | null> {
  let res: Response;
  try {
    res = await fetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error(
      "[auth/oauth-google] userinfo network error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
  if (!res.ok) return null;
  try {
    const body = (await res.json()) as Partial<GoogleUserinfo>;
    if (typeof body.sub !== "string" || typeof body.email !== "string") {
      return null;
    }
    return body as GoogleUserinfo;
  } catch {
    return null;
  }
}

export interface LinkOrCreateResult {
  userId: string;
  /** True if we created a new users row this call. False if we linked
   *  to an existing user OR re-used an existing oauth_account row. */
  newlyCreated: boolean;
  /** True if we wrote a new oauth_account row this call (either because
   *  the user existed but wasn't linked, or because we created a new
   *  user). False if the (provider, subject) link already existed. */
  newlyLinked: boolean;
}

/**
 * Three-branch resolver for what to do with a verified Google identity:
 *
 *   1. oauth_account exists for (google, sub)
 *        → log in as the linked user (no schema changes)
 *
 *   2. user exists by email but no oauth_account
 *        → link the existing user (insert oauth_account row)
 *
 *   3. nothing exists
 *        → create user (role=member, email_verified_at=now since
 *          Google asserted the email is verified) + insert
 *          oauth_account
 *
 * Caller MUST have already verified `userinfo.email_verified === true`
 * before calling. If the user exists but is deactivated, throws so the
 * route handler can reject the sign-in cleanly.
 */
export async function linkOrCreateUserFromGoogle(
  userinfo: GoogleUserinfo,
): Promise<LinkOrCreateResult> {
  const db = getDb();
  const normalizedEmail = userinfo.email.trim().toLowerCase();

  // Branch 1: existing (provider, subject) link.
  const linkRow = await db
    .select({
      userId: oauthAccount.userId,
    })
    .from(oauthAccount)
    .where(
      and(
        eq(oauthAccount.provider, "google"),
        eq(oauthAccount.providerSubject, userinfo.sub),
      ),
    )
    .limit(1);

  if (linkRow.length > 0) {
    // Confirm the linked user is still active. If deactivated, refuse
    // sign-in (admin must reactivate).
    const u = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, linkRow[0].userId))
      .limit(1);
    if (u.length === 0 || !u[0].isActive) {
      throw new Error("linkOrCreateUserFromGoogle: linked user deactivated");
    }
    return {
      userId: linkRow[0].userId,
      newlyCreated: false,
      newlyLinked: false,
    };
  }

  // Branch 2: user exists by email; create the oauth_account link.
  const userRow = await db
    .select({
      id: users.id,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalizedEmail))
    .limit(1);

  if (userRow.length > 0) {
    if (!userRow[0].isActive) {
      throw new Error(
        "linkOrCreateUserFromGoogle: existing user is deactivated",
      );
    }
    await db.insert(oauthAccount).values({
      userId: userRow[0].id,
      provider: "google",
      providerSubject: userinfo.sub,
      emailAtLink: userinfo.email,
    });
    return {
      userId: userRow[0].id,
      newlyCreated: false,
      newlyLinked: true,
    };
  }

  // Branch 3: brand-new user. Google asserted email_verified, so we
  // stamp email_verified_at at creation time.
  const displayName =
    userinfo.name ||
    [userinfo.given_name, userinfo.family_name].filter(Boolean).join(" ") ||
    userinfo.email;

  const inserted = await db
    .insert(users)
    .values({
      email: userinfo.email,
      displayName,
      role: "member",
      isActive: true,
      tokenVersion: 0,
      emailVerifiedAt: new Date(),
      // passwordHash stays NULL — OAuth-only account.
    })
    .returning({ id: users.id });

  await db.insert(oauthAccount).values({
    userId: inserted[0].id,
    provider: "google",
    providerSubject: userinfo.sub,
    emailAtLink: userinfo.email,
  });

  return {
    userId: inserted[0].id,
    newlyCreated: true,
    newlyLinked: true,
  };
}

/**
 * Mint a session for a user resolved via Google. Thin wrapper so the
 * route handler reads as a single linear flow.
 */
export async function issueSessionForGoogleUser(opts: {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): ReturnType<typeof issueSession> {
  return issueSession(opts);
}
