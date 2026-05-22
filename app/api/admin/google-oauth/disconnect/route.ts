import { NextResponse } from "next/server";
import { isNotNull } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { consultant } from "../../../../../lib/db/schema";
import { clearAccessTokenCache } from "../../../../../lib/google-calendar";

// POST /api/admin/google-oauth/disconnect
//
// Clears the Google grant on the connected consultant row. Refresh token,
// calendar id, status all reset. Booking flow refuses to create slots
// for consultants in 'pending' status, so the booking page becomes
// unavailable until the admin reconnects.
//
// Identifies "the connected consultant" as any row with a non-null refresh
// token. Earlier the route matched consultant.email against
// integration_config.contact_recipient_email; that coupling broke silently
// when the admin updated the contact recipient in the UI without changing
// consultant.email, leaving Disconnect a no-op (route returned 200 + 0 rows
// updated, so the UI kept showing "Connected" forever).
//
// Does NOT revoke the grant at Google's end — that requires a separate
// API call and is an "if you really care" step. The encrypted refresh
// token is destroyed locally, which is the only thing we control.

export const runtime = "nodejs";

export async function POST() {
  try {
    const db = getDb();
    const result = await db
      .update(consultant)
      .set({
        googleRefreshTokenEncrypted: null,
        googleCalendarId: null,
        googleStatus: "pending",
        updatedAt: new Date(),
      })
      .where(isNotNull(consultant.googleRefreshTokenEncrypted))
      .returning({ id: consultant.id });

    if (result.length === 0) {
      return NextResponse.json(
        { ok: true, message: "No connected consultant to disconnect." },
        { status: 200 },
      );
    }
    // Bust the in-memory access-token cache so any in-flight slot
    // queries don't keep using a token that's about to be unusable.
    for (const row of result) {
      clearAccessTokenCache(row.id);
    }
  } catch (err) {
    console.error("[google-oauth/disconnect] update failed:", err);
    return NextResponse.json(
      { error: "Could not disconnect the Google grant." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
