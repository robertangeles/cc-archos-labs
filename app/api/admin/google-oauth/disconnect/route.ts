import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { consultant } from "../../../../../lib/db/schema";
import { clearAccessTokenCache } from "../../../../../lib/google-calendar";
import { getIntegrationConfig } from "../../../../../lib/integration-config";

// POST /api/admin/google-oauth/disconnect
//
// Clears the Google grant on the single-consultant row. Refresh token,
// calendar id, status all reset. Booking flow refuses to create slots
// for consultants in 'pending' status, so the booking page becomes
// unavailable until the admin reconnects.
//
// Does NOT revoke the grant at Google's end — that requires a separate
// API call and is an "if you really care" step. The encrypted refresh
// token is destroyed locally, which is the only thing we control.

export const runtime = "nodejs";

export async function POST() {
  let consultantEmail: string;
  try {
    const config = await getIntegrationConfig();
    consultantEmail = config.contactRecipientEmail;
  } catch (err) {
    console.error("[google-oauth/disconnect] config load failed:", err);
    return NextResponse.json(
      { error: "Cannot resolve consultant identity from integration config." },
      { status: 500 },
    );
  }

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
      .where(eq(consultant.email, consultantEmail))
      .returning({ id: consultant.id });

    if (result.length === 0) {
      return NextResponse.json(
        { ok: true, message: "No consultant row to disconnect." },
        { status: 200 },
      );
    }
    // Bust the in-memory access-token cache so any in-flight slot
    // queries don't keep using a token that's about to be unusable.
    clearAccessTokenCache(result[0].id);
  } catch (err) {
    console.error("[google-oauth/disconnect] update failed:", err);
    return NextResponse.json(
      { error: "Could not disconnect the Google grant." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
