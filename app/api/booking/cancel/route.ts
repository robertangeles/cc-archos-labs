import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildBookingCancellationEmail } from "../../../../lib/booking-emails";
import {
  markBookingCancelled,
  verifyManageToken,
} from "../../../../lib/booking";
import {
  JWTExpiredError,
  JWTInvalidError,
  JWTRevokedError,
} from "../../../../lib/errors/booking";
import { deleteEvent } from "../../../../lib/google-calendar";
import { getPublicOrigin } from "../../../../lib/public-origin";
import { getResend } from "../../../../lib/resend";
import { cancelJobsForBooking } from "../../../../lib/scheduler";

// POST /api/booking/cancel
//
// Body: { token: string }
// Verifies the magic-link JWT + jti, marks the booking cancelled,
// deletes the Google event (which fires Google's native "Event
// cancelled" email to attendees via sendUpdates=all), sends our
// branded cancellation email via Resend, and cancels any pending
// scheduled_job rows so reminders stop.
//
// Status codes:
//   401 — token invalid / expired / revoked (already used or
//         superseded by a reschedule)
//   409 — booking can't be cancelled in its current status
//         (already cancelled / completed / no_show)
//   503 — Google or DB unavailable; safe to retry
//   200 — cancelled successfully (idempotent on retry: a second cancel
//         with a now-revoked token returns 401, the caller surfaces
//         "already cancelled" to the user)

export const runtime = "nodejs";

const BodySchema = z.object({
  token: z.string().min(20).max(2048),
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    const json = await request.json();
    body = BodySchema.parse(json);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  // 1. Verify token + load booking + consultant ----------------------------
  let context: Awaited<ReturnType<typeof verifyManageToken>>;
  try {
    context = await verifyManageToken({ token: body.token });
  } catch (err) {
    if (
      err instanceof JWTInvalidError ||
      err instanceof JWTExpiredError ||
      err instanceof JWTRevokedError
    ) {
      return NextResponse.json(
        { ok: false, error: "This link is no longer valid." },
        { status: 401 },
      );
    }
    console.error("[booking/cancel] token verify failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not verify cancel link." },
      { status: 500 },
    );
  }

  const { booking, consultant } = context;

  // 2. State machine check -------------------------------------------------
  if (booking.status !== "confirmed" && booking.status !== "pending_calendar_sync") {
    return NextResponse.json(
      {
        ok: false,
        error: "This booking can't be cancelled — already cancelled or past.",
      },
      { status: 409 },
    );
  }

  // 3. Mark cancelled in DB first ------------------------------------------
  // Do this before the Google API call so that even if Google or Resend
  // fails after, the booking state is correct — the operator can
  // manually clean up the Google event from their calendar.
  try {
    await markBookingCancelled({ bookingId: booking.id, now: new Date() });
  } catch (err) {
    console.error("[booking/cancel] DB update failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not cancel — please retry." },
      { status: 503 },
    );
  }

  // 4. Cancel pending scheduled_job rows (reminders, brief, etc.) ----------
  try {
    await cancelJobsForBooking({
      bookingId: booking.id,
      reason: "booking cancelled via manage link",
      now: new Date(),
    });
  } catch (err) {
    // Logged but not fatal — leftover pending jobs will harmlessly
    // skip when the cron sees status='cancelled' on the booking.
    console.error("[booking/cancel] scheduler cancel failed:", err);
  }

  // 5. Delete the Google event (sendUpdates=all triggers Google's
  //    native "Event cancelled" email to attendees) ----------------------
  if (booking.googleEventId && consultant.googleCalendarId) {
    try {
      await deleteEvent({
        consultantId: consultant.id,
        calendarId: consultant.googleCalendarId,
        eventId: booking.googleEventId,
        notifyAttendees: true,
      });
    } catch (err) {
      // Don't fail the whole cancel just because Google's reachable
      // window blipped — the booking is cancelled on our side. Operator
      // can clean up the stale Google event from their calendar UI.
      console.error("[booking/cancel] google delete failed:", err);
    }
  }

  // 6. Send our branded cancellation email --------------------------------
  try {
    const origin = getPublicOrigin(request);
    const email = buildBookingCancellationEmail({
      prospectFirstName: firstNameFrom(booking.name),
      slotStartLocal: formatSlotInTz(
        booking.slotStart,
        booking.prospectTimezone,
      ),
      bookAgainUrl: `${origin}/book/${consultant.slug}`,
    });
    const { resend, from } = await getResend();
    await resend.emails.send({
      from,
      to: booking.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (err) {
    console.error("[booking/cancel] cancellation email failed:", err);
    // Don't fail the whole cancel — Google's native email already
    // notified the prospect.
  }

  return NextResponse.json({ ok: true });
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function firstNameFrom(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] ?? "there";
}

function formatSlotInTz(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

