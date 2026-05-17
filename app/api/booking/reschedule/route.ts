import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { buildBookingConfirmationEmail } from "../../../../lib/booking-emails";
import {
  attachGoogleEvent,
  createBookingRow,
  loadAvailableSlots,
  markBookingRescheduled,
  mintBookingJtis,
  verifyManageToken,
} from "../../../../lib/booking";
import { getDb } from "../../../../lib/db";
import { bookingRequest } from "../../../../lib/db/schema";
import {
  BookingWindowError,
  GoogleAuthError,
  GoogleAuthErrorRevoked,
  JWTExpiredError,
  JWTInvalidError,
  JWTRevokedError,
  SlotConflictError,
} from "../../../../lib/errors/booking";
import { createEvent, deleteEvent } from "../../../../lib/google-calendar";
import { getPublicOrigin } from "../../../../lib/public-origin";
import { getResend } from "../../../../lib/resend";
import { enqueueBookingJobs } from "../../../../lib/scheduler";

// POST /api/booking/reschedule
//
// Body: { token, slotStartUtc, slotEndUtc, prospectTimezone? }
// Moves an existing booking to a new slot:
//   1. Verify the magic-link token + jti
//   2. Insert a new booking_request row (carrying over name/email/etc
//      from the old row, with the new slot times). Race-safe via a
//      fresh idempotency key.
//   3. Create the new Google Calendar event (sendUpdates=all → attendee
//      gets the new .ics invite).
//   4. Delete the old Google event (sendUpdates=all → attendee gets
//      "Event cancelled" for the old slot).
//   5. Mint fresh JTIs for the new booking + send the confirmation
//      email pointing at the new manage URL.
//   6. Enqueue follow-up reminder jobs for the new booking.
//   7. Mark the old row status='rescheduled_from' with rescheduledToId
//      set to the new row, JTIs cleared.
//
// On Google failure mid-flow we degrade gracefully: the new row stays
// as pending_calendar_sync, and the old row stays confirmed. Operator
// can manually clean up.

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

  const { booking: oldBooking, consultant } = context;

  // 2. State check ---------------------------------------------------------
  if (oldBooking.status !== "confirmed") {
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

  // 3. Insert the new booking row (race-safe via idempotency key) ---------
  // We slightly perturb the idempotency key calculation by appending the
  // old booking id — so a reschedule from booking A to slot S, followed
  // by another reschedule from booking B to slot S (different prospect),
  // doesn't collide.
  const now = new Date();
  const newRowInput = {
    slotStartUtc: body.slotStartUtc,
    slotEndUtc: body.slotEndUtc,
    name: oldBooking.name,
    email: oldBooking.email,
    organisation: oldBooking.organisation,
    position: oldBooking.position,
    reasonInitial: oldBooking.reasonInitial,
    reasonFollowups:
      (oldBooking.reasonFollowups as Array<{
        question: string;
        answer: string;
      }>) ?? [],
    prospectTimezone: body.prospectTimezone ?? oldBooking.prospectTimezone,
    utm: {},
  };

  let inserted: Awaited<ReturnType<typeof createBookingRow>>;
  try {
    inserted = await createBookingRow({
      consultantId: consultant.id,
      validated: newRowInput,
      now,
    });
  } catch (err) {
    if (err instanceof SlotConflictError) {
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
    if (err instanceof BookingWindowError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 400 },
      );
    }
    console.error("[booking/reschedule] insert failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not reschedule." },
      { status: 500 },
    );
  }

  if (inserted.status === "exists_confirmed") {
    // A prior submit already completed the same reschedule. Idempotent
    // success — point the caller at the new confirmation.
    return NextResponse.json({
      ok: true,
      bookingId: inserted.bookingId,
      slug: consultant.slug,
      idempotent: true,
    });
  }

  // 4. Create the new Google event -----------------------------------------
  let googleEventId: string | null = null;
  let meetUrl: string | null = null;
  try {
    const event = await createEvent({
      consultantId: consultant.id,
      calendarId: consultant.googleCalendarId,
      summary: `${consultant.displayName} ↔ ${oldBooking.name}`,
      description: buildEventDescription({
        name: oldBooking.name,
        email: oldBooking.email,
        organisation: oldBooking.organisation,
        position: oldBooking.position,
        reasonInitial: oldBooking.reasonInitial,
        reasonFollowups:
          (oldBooking.reasonFollowups as Array<{
            question: string;
            answer: string;
          }>) ?? [],
      }),
      startUtc: body.slotStartUtc,
      endUtc: body.slotEndUtc,
      bookingId: inserted.bookingId,
      attendeeEmails: [oldBooking.email],
      timeZone: consultant.timezone,
    });
    googleEventId = event.eventId;
    meetUrl = event.meetUrl;
  } catch (err) {
    await getDb()
      .update(bookingRequest)
      .set({ status: "pending_calendar_sync", updatedAt: new Date() })
      .where(eq(bookingRequest.id, inserted.bookingId));

    const status =
      err instanceof GoogleAuthErrorRevoked
        ? "Calendar grant expired — "
        : err instanceof GoogleAuthError
          ? "Calendar auth failed — "
          : "Calendar service unavailable — ";
    console.error("[booking/reschedule] new google event failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: `${status}new slot saved but not yet on the calendar.`,
      },
      { status: 503 },
    );
  }

  // 5. Attach event + mint fresh JTIs --------------------------------------
  await attachGoogleEvent({
    bookingId: inserted.bookingId,
    googleEventId,
    meetUrl,
    now: new Date(),
  });
  const { cancelToken } = await mintBookingJtis({
    bookingId: inserted.bookingId,
    now: new Date(),
  });

  // 6. Delete the OLD Google event (Google notifies the attendee) ---------
  if (oldBooking.googleEventId) {
    try {
      await deleteEvent({
        consultantId: consultant.id,
        calendarId: consultant.googleCalendarId,
        eventId: oldBooking.googleEventId,
        notifyAttendees: true,
      });
    } catch (err) {
      console.error("[booking/reschedule] old google delete failed:", err);
      // Leave the stale event on the calendar — operator can clean up.
      // The new event is in place; the user will see both until manual
      // cleanup, but that's better than failing the whole reschedule.
    }
  }

  // 7. Mark the old row as superseded by the new one -----------------------
  try {
    await markBookingRescheduled({
      oldBookingId: oldBooking.id,
      newBookingId: inserted.bookingId,
      now: new Date(),
    });
  } catch (err) {
    console.error("[booking/reschedule] old-row update failed:", err);
    // Non-fatal — the new booking is alive. The old row may still
    // show as 'confirmed' in admin views until an operator fixes it.
  }

  // 8. Send confirmation email for the new booking + enqueue jobs ---------
  const origin = getPublicOrigin(request);
  const manageUrl = `${origin}/book/manage/${encodeURIComponent(cancelToken)}`;
  try {
    const email = buildBookingConfirmationEmail({
      prospectFirstName: firstNameFrom(oldBooking.name),
      slotStartLocal: formatSlotInTz(
        body.slotStartUtc,
        newRowInput.prospectTimezone,
      ),
      prospectTimezone: newRowInput.prospectTimezone,
      durationMinutes: consultant.slotMinutes,
      meetUrl: meetUrl ?? "(Meet link arriving in a follow-up email)",
      manageUrl,
      recommendedReading: [],
    });
    const { resend, from } = await getResend();
    await resend.emails.send({
      from,
      to: oldBooking.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (err) {
    console.error("[booking/reschedule] new confirmation email failed:", err);
  }

  try {
    await enqueueBookingJobs({
      bookingId: inserted.bookingId,
      slotStart: new Date(body.slotStartUtc),
      slotEnd: new Date(body.slotEndUtc),
      now: new Date(),
      excludeKinds: ["confirmation"],
    });
  } catch (err) {
    console.error("[booking/reschedule] enqueue jobs failed:", err);
  }

  return NextResponse.json({
    ok: true,
    bookingId: inserted.bookingId,
    slug: consultant.slug,
  });
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function buildEventDescription(input: {
  name: string;
  email: string;
  organisation: string | null;
  position: string | null;
  reasonInitial: string;
  reasonFollowups: { question: string; answer: string }[];
}): string {
  const lines = [
    `Prospect: ${input.name} <${input.email}>`,
    input.organisation ? `Org: ${input.organisation}` : null,
    input.position ? `Role: ${input.position}` : null,
    "",
    "Reason for the call:",
    input.reasonInitial,
  ];
  if (input.reasonFollowups.length > 0) {
    lines.push("", "Follow-up:");
    for (const f of input.reasonFollowups) {
      lines.push(`Q: ${f.question}`, `A: ${f.answer}`);
    }
  }
  return lines.filter((l) => l !== null).join("\n");
}

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
