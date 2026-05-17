import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { buildBookingConfirmationEmail } from "../../../../lib/booking-emails";
import {
  loadAvailableSlots,
  rescheduleBookingSlot,
  verifyManageToken,
} from "../../../../lib/booking";
import { getDb } from "../../../../lib/db";
import { bookingRequest } from "../../../../lib/db/schema";
import {
  GoogleAuthError,
  GoogleAuthErrorRevoked,
  JWTExpiredError,
  JWTInvalidError,
  JWTRevokedError,
} from "../../../../lib/errors/booking";
import { updateEventTime } from "../../../../lib/google-calendar";
import { generateJti, signMagicLink } from "../../../../lib/jwt-magic-link";
import { getPublicOrigin } from "../../../../lib/public-origin";
import { getResend } from "../../../../lib/resend";
import {
  cancelJobsForBooking,
  enqueueBookingJobs,
} from "../../../../lib/scheduler";

// POST /api/booking/reschedule
//
// Body: { token, slotStartUtc, slotEndUtc, prospectTimezone? }
// Moves an EXISTING booking to a new slot in place. The booking_request
// row stays the same row; we just update slot_start + slot_end. Google
// Calendar's events.patch moves the event with a single "Event updated"
// notification — preserves event id, fires one .ics email to the
// attendee, no phantom cancellation. Cleaner than delete-and-create.
//
// Status codes:
//   401 — token invalid / expired / revoked
//   409 — new slot conflicts with an existing booking
//   503 — Google unreachable; old slot still intact
//   400 — input invalid (Zod or window)
//   200 — rescheduled successfully; client navigates to confirmation

export const runtime = "nodejs";

const BodySchema = z.object({
  token: z.string().min(20).max(2048),
  slotStartUtc: z.string().datetime({ offset: true }),
  slotEndUtc: z.string().datetime({ offset: true }),
  prospectTimezone: z.string().min(1).max(80).optional(),
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

  // 1. Verify token + load context -----------------------------------------
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
    console.error("[booking/reschedule] token verify failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not verify the reschedule link." },
      { status: 500 },
    );
  }

  const { booking, consultant } = context;

  // 2. State checks --------------------------------------------------------
  if (booking.status !== "confirmed") {
    return NextResponse.json(
      {
        ok: false,
        error: "This booking can't be rescheduled — already cancelled or past.",
      },
      { status: 409 },
    );
  }
  if (consultant.googleStatus !== "ok" || !consultant.googleCalendarId) {
    return NextResponse.json(
      { ok: false, error: "Calendar is not connected." },
      { status: 503 },
    );
  }
  if (!booking.googleEventId) {
    return NextResponse.json(
      {
        ok: false,
        error: "This booking has no Google event yet — can't reschedule.",
      },
      { status: 503 },
    );
  }

  const newSlotStart = new Date(body.slotStartUtc);
  const newSlotEnd = new Date(body.slotEndUtc);
  const now = new Date();

  if (newSlotEnd.getTime() <= newSlotStart.getTime()) {
    return NextResponse.json(
      { ok: false, error: "New slot end must be after start." },
      { status: 400 },
    );
  }
  if (newSlotStart.getTime() <= now.getTime()) {
    return NextResponse.json(
      { ok: false, error: "New slot is in the past." },
      { status: 400 },
    );
  }

  // 3. Slot-conflict check — refuse if another confirmed booking already
  //    owns the new slot. Exclude THIS booking so moving to the same
  //    time is a no-op rather than a self-collision.
  const db = getDb();
  const conflict = await db
    .select({ id: bookingRequest.id })
    .from(bookingRequest)
    .where(
      and(
        eq(bookingRequest.consultantId, consultant.id),
        eq(bookingRequest.status, "confirmed"),
        eq(bookingRequest.slotStart, newSlotStart),
        ne(bookingRequest.id, booking.id),
      ),
    )
    .limit(1);
  if (conflict[0]) {
    const fresh = await loadAvailableSlots({ consultant, now }).catch(
      () => null,
    );
    return NextResponse.json(
      {
        ok: false,
        error: "That slot was just taken. Pick another.",
        slots: fresh?.slots ?? null,
      },
      { status: 409 },
    );
  }

  // 4. PATCH the Google event -----------------------------------------------
  // Single API call moves the event + fires the "Event updated"
  // notification to attendees (.ics attached).
  try {
    await updateEventTime({
      consultantId: consultant.id,
      calendarId: consultant.googleCalendarId,
      eventId: booking.googleEventId,
      startUtc: body.slotStartUtc,
      endUtc: body.slotEndUtc,
      timeZone: consultant.timezone,
    });
  } catch (err) {
    const prefix =
      err instanceof GoogleAuthErrorRevoked
        ? "Calendar grant expired — "
        : err instanceof GoogleAuthError
          ? "Calendar auth failed — "
          : "Calendar service unavailable — ";
    console.error("[booking/reschedule] google patch failed:", err);
    return NextResponse.json(
      { ok: false, error: `${prefix}old slot is still intact. Try again.` },
      { status: 503 },
    );
  }

  // 5. Update the booking row + rotate JTIs --------------------------------
  // The cancel/reschedule magic link in the confirmation email is
  // single-use; mint fresh JTIs so the next email's link works again.
  const newCancelJti = generateJti();
  const newRescheduleJti = generateJti();
  await rescheduleBookingSlot({
    bookingId: booking.id,
    newSlotStart,
    newSlotEnd,
    newCancelJti,
    newRescheduleJti,
    now: new Date(),
  });

  // 6. Cancel pending scheduled jobs + enqueue new ones for the new slot ---
  try {
    await cancelJobsForBooking({
      bookingId: booking.id,
      reason: "booking rescheduled",
      now: new Date(),
    });
    await enqueueBookingJobs({
      bookingId: booking.id,
      slotStart: newSlotStart,
      slotEnd: newSlotEnd,
      now: new Date(),
      excludeKinds: ["confirmation"],
    });
  } catch (err) {
    // Non-fatal — the reschedule has happened on Google + DB. Stale
    // pending jobs from the old slot will harmlessly skip when cron
    // sees the new slot_start in the booking row.
    console.error("[booking/reschedule] requeue jobs failed:", err);
  }

  // 7. Send our branded confirmation email with the new manage URL --------
  const origin = getPublicOrigin(request);
  const newManageToken = await signMagicLink(
    booking.id,
    "cancel",
    newCancelJti,
  );
  const newManageUrl = `${origin}/book/manage/${encodeURIComponent(newManageToken)}`;
  const prospectTimezone =
    body.prospectTimezone ?? booking.prospectTimezone;
  try {
    const email = buildBookingConfirmationEmail({
      prospectFirstName: firstNameFrom(booking.name),
      slotStartLocal: formatSlotInTz(body.slotStartUtc, prospectTimezone),
      prospectTimezone,
      durationMinutes: consultant.slotMinutes,
      meetUrl: booking.meetUrl ?? "(Meet link in your calendar invite)",
      manageUrl: newManageUrl,
      recommendedReading: [],
    });
    const { resend, from } = await getResend();
    await resend.emails.send({
      from,
      to: booking.email,
      subject: email.subject.replace(
        "You're booked for",
        "Your call has been moved to",
      ),
      html: email.html,
      text: email.text.replace(
        "You're on the calendar for",
        "Your call is now at",
      ),
    });
  } catch (err) {
    console.error(
      "[booking/reschedule] confirmation email failed:",
      err,
    );
    // Don't fail the whole reschedule — Google's "Event updated" email
    // already covered the calendar side.
  }

  // 8. Update the prospect_timezone on the row if the form sent a new one.
  //    Defensive — most reschedules come from the same prospect on the
  //    same device, so the tz rarely changes.
  if (body.prospectTimezone && body.prospectTimezone !== booking.prospectTimezone) {
    await db
      .update(bookingRequest)
      .set({ prospectTimezone: body.prospectTimezone, updatedAt: new Date() })
      .where(eq(bookingRequest.id, booking.id));
  }

  return NextResponse.json({
    ok: true,
    bookingId: booking.id,
    slug: consultant.slug,
  });
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function firstNameFrom(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] ?? "there";
}

function formatSlotInTz(isoUtc: string, tz: string): string {
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
    }).format(new Date(isoUtc));
  } catch {
    return isoUtc;
  }
}
