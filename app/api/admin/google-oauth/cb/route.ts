import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { encrypt } from "../../../../../lib/booking-crypto";
import { getDb } from "../../../../../lib/db";
import { consultant } from "../../../../../lib/db/schema";
import { BookingError, GoogleAuthError } from "../../../../../lib/errors/booking";
import { exchangeCodeForTokens } from "../../../../../lib/google-oauth";
import { getIntegrationConfig } from "../../../../../lib/integration-config";
import { getSiteSettings } from "../../../../../lib/site-config";
import { STATE_COOKIE } from "../start/route";

// GET /api/admin/google-oauth/cb?code=...&state=...
//
// Handles the redirect from Google's consent screen. Validates the
// state nonce (cookie vs query), exchanges the auth code for a refresh
// token + access token, encrypts the refresh token, upserts the
// consultant row by email (single-consultant v1 — keyed on the
// integration_secrets.contactRecipientEmail value), and redirects the
// admin back to /admin/google with a status flag.

export const runtime = "nodejs";

// Default working hours for a freshly-created consultant. Admin can
// edit these in a future profile UI; until then they sit at a sensible
// "weekdays 9–5" so the slot generator returns something the moment the
// grant lands.
const DEFAULT_WORKING_HOURS = {
  mon: [9, 17],
  tue: [9, 17],
  wed: [9, 17],
  thu: [9, 17],
  fri: [9, 17],
} as const;

function redirectToAdmin(
  base: URL,
  status: "connected" | "denied" | "state_mismatch" | "no_code" | "error",
  detail?: string,
): NextResponse {
  const url = new URL("/admin/google", base);
  url.searchParams.set("status", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 200));
  const response = NextResponse.redirect(url);
  // Always clear the state cookie — single-use semantics.
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin/google-oauth",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Google appends ?error=access_denied when Rob clicks "Cancel" on the
  // consent screen. Surface it as a benign redirect, not a 500.
  if (error) {
    return redirectToAdmin(url, "denied", error);
  }
  if (!code || !stateParam) {
    return redirectToAdmin(url, "no_code");
  }

  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  if (!cookieState || cookieState !== stateParam) {
    return redirectToAdmin(url, "state_mismatch");
  }

  let refreshTokenPlain: string;
  try {
    const tokens = await exchangeCodeForTokens(code);
    refreshTokenPlain = tokens.refreshToken;
  } catch (err) {
    const message =
      err instanceof GoogleAuthError || err instanceof BookingError
        ? err.message
        : "Google token exchange failed.";
    console.error("[google-oauth/cb] exchange failed:", err);
    return redirectToAdmin(url, "error", message);
  }

  // Encrypt the refresh token with the master key before persisting.
  const refreshTokenEncrypted = encrypt(refreshTokenPlain);

  // Resolve consultant identity for v1 single-consultant: email comes
  // from the contactRecipientEmail config, display name from
  // site_setting.founderName. The admin can override both in a future
  // profile UI.
  let consultantEmail: string;
  let consultantDisplayName: string;
  try {
    const config = await getIntegrationConfig();
    consultantEmail = config.contactRecipientEmail;
    const settings = await getSiteSettings();
    consultantDisplayName = settings.founderName || consultantEmail;
  } catch (err) {
    console.error("[google-oauth/cb] config load failed:", err);
    return redirectToAdmin(
      url,
      "error",
      "Cannot resolve consultant identity from integration config.",
    );
  }

  try {
    const db = getDb();
    const existing = await db
      .select({ id: consultant.id })
      .from(consultant)
      .where(eq(consultant.email, consultantEmail))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(consultant)
        .set({
          googleRefreshTokenEncrypted: refreshTokenEncrypted,
          googleCalendarId: "primary",
          googleStatus: "ok",
          updatedAt: new Date(),
        })
        .where(eq(consultant.id, existing[0].id));
    } else {
      await db.insert(consultant).values({
        email: consultantEmail,
        displayName: consultantDisplayName,
        workingHoursJson: DEFAULT_WORKING_HOURS,
        googleRefreshTokenEncrypted: refreshTokenEncrypted,
        googleCalendarId: "primary",
        googleStatus: "ok",
      });
    }
  } catch (err) {
    console.error("[google-oauth/cb] consultant upsert failed:", err);
    return redirectToAdmin(url, "error", "Could not persist Google grant.");
  }

  return redirectToAdmin(url, "connected");
}
