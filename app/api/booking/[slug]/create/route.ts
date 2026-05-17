import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { buildBookingConfirmationEmail } from "../../../../../lib/booking-emails";
import {
  attachGoogleEvent,
  createBookingInputSchema,
  createBookingRow,
  getConsultantBySlug,
  loadAvailableSlots,
} from "../../../../../lib/booking";
import { getDb } from "../../../../../lib/db";
import { bookingRequest } from "../../../../../lib/db/schema";
import {
  BookingWindowError,
  GoogleAuthError,
  GoogleAuthErrorRevoked,
  HoneypotError,
  SlotConflictError,
} from "../../../../../lib/errors/booking";
import { createEvent } from "../../../../../lib/google-calendar";
import { generateJti, signMagicLink } from "../../../../../lib/jwt-magic-link";
import { getPublicOrigin } from "../../../../../lib/public-origin";
import { getResend } from "../../../../../lib/resend";
import { enqueueBookingJobs } from "../../../../../lib/scheduler";
import { isTurnstileConfigured, verifyTurnstile } from "../../../../../lib/turnstile";

// POST /api/booking/[slug]/create
//
// The big one. Validates the form payload, runs anti-spam checks
// (honeypot + Turnstile), inserts a booking_request row race-safely,
// creates the Google Calendar event with a Meet link, sends the
// confirmation email synchronously, and enqueues the 5 follow-up
// scheduled jobs (cron in PR #44 will fire them).
//
// Anti-spam:
//   - honeypot field "website" must be empty (legit submits don't fill it)
//   - Turnstile token must verify (if Turnstile is configured)
//
// Failure modes (each returns a specific status):
//   400 — input validation failed, honeypot tripped, Turnstile failed
//   404 — consultant slug not found
//   409 — slot taken between availability check and submit
//   503 — Google unreachable or grant revoked (booking NOT persisted)
//   500 — internal error (logged)

export const runtime = "nodejs";

// Wire-level body: superset of createBookingInputSchema. Honeypot +
// Turnstile token live here only; the rest passes through to lib/booking.
const RequestBodySchema = z
  .object({
    // Honeypot — must be empty. Bots fill all visible-ish fields.
    website: z.string().max(0, "honeypot tripped").optional().default(""),
    // Turnstile token from the widget. May be empty when Turnstile is
    // unconfigured (route checks that case before requiring it).
    turnstileToken: z.string().max(2048).optional().default(""),
  })
  .and(createBookingInputSchema);

interface Params {
  params: Promise<{ slug: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const now = new Date();

  // 1. Consultant lookup ----------------------------------------------------
  const consultant = await getConsultantBySlug(slug);
  if (!consultant) {
    return NextResponse.json(
      { ok: false, error: "Consultant not found." },
      { status: 404 },
    );
  }
  if (consultant.googleStatus !== "ok" || !consultant.googleCalendarId) {
    return NextResponse.json(
      { ok: false, error: "Booking is paused — calendar is not connected." },
      { status: 503 },
    );
  }

  // 2. Parse + validate body ------------------------------------------------
  let body: z.infer<typeof RequestBodySchema>;
  try {
    const json = await request.json();
    body = RequestBodySchema.parse(json);
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? `Invalid form data: ${err.issues[0]?.message ?? "shape mismatch"}`
        : "Invalid form data.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  // 3. Anti-spam ------------------------------------------------------------
  if (body.website && body.website.length > 0) {
    // Don't tell the bot why we rejected — return a generic 400.
    throw new HoneypotError("honeypot field filled");
  }

  if (await isTurnstileConfigured()) {
    try {
      await verifyTurnstile({
        token: body.turnstileToken,
        remoteIp:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          undefined,
      });
    } catch (err) {
      console.warn(
        "[booking/create] turnstile rejected:",
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json(
        { ok: false, error: "Bot check failed. Refresh and try again." },
        { status: 400 },
      );
    }
  }

  // 4. Insert booking row (race-safe via idempotency_key) -------------------
  let inserted: Awaited<ReturnType<typeof createBookingRow>>;
  try {
    inserted = await createBookingRow({
      consultantId: consultant.id,
      validated: body,
      now,
    });
  } catch (err) {
    if (err instanceof SlotConflictError) {
      // Refresh availability so the page can show the latest slot list.
      const fresh = await loadAvailableSlots({ consultant, now }).catch(() => null);
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
    console.error("[booking/create] insert failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not create booking." },
      { status: 500 },
    );
  }

  // Idempotent replay: a second identical POST might find:
  //   - exists_confirmed → booking already fully landed (Google event +
  //     email + jtis). Short-circuit to the confirmation page.
  //   - exists_pending_sync → a prior submit inserted the row but
  //     Google failed at the event-creation step. Fall through and
  //     retry steps 5-8 (Google + jtis + email + enqueue). Once the
  //     attach succeeds, status flips back to 'confirmed' so the
  //     confirmation page clears the "sync delayed" banner.
  if (inserted.status === "exists_confirmed") {
    return NextResponse.json({
      ok: true,
      bookingId: inserted.bookingId,
      idempotent: true,
    });
  }

  // 5. Create Google Calendar event + Meet link -----------------------------
  let googleEventId: string | null = null;
  let meetUrl: string | null = null;
  try {
    const event = await createEvent({
      consultantId: consultant.id,
      calendarId: consultant.googleCalendarId,
      summary: `${consultant.displayName} ↔ ${body.name}`,
      description: buildEventDescription({
        name: body.name,
        email: body.email,
        organisation: body.organisation,
        position: body.position,
        reasonInitial: body.reasonInitial,
        reasonFollowups: body.reasonFollowups,
      }),
      startUtc: body.slotStartUtc,
      endUtc: body.slotEndUtc,
      bookingId: inserted.bookingId,
      attendeeEmails: [body.email],
      timeZone: consultant.timezone,
    });
    googleEventId = event.eventId;
    meetUrl = event.meetUrl;
  } catch (err) {
    // Google failed AFTER we wrote the row. Mark the booking for cron
    // retry and return 503 — the user can re-submit and we'll be
    // idempotent on the second try.
    await getDb()
      .update(bookingRequest)
      .set({
        status: "pending_calendar_sync",
        updatedAt: new Date(),
      })
      .where(eq(bookingRequest.id, inserted.bookingId));

    const status =
      err instanceof GoogleAuthErrorRevoked
        ? "Calendar grant expired — contact us at "
        : err instanceof GoogleAuthError
          ? "Calendar auth failed — "
          : "Calendar service unavailable — ";

    console.error("[booking/create] google event creation failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: `${status}your booking is saved but not yet on the calendar. Try again or contact us.`,
      },
      { status: 503 },
    );
  }

  // 6. Persist event id + meet url + mint magic-link JTIs ------------------
  const cancelJti = generateJti();
  const rescheduleJti = generateJti();
  try {
    await attachGoogleEvent({
      bookingId: inserted.bookingId,
      googleEventId,
      meetUrl,
      now: new Date(),
    });
    await getDb()
      .update(bookingRequest)
      .set({
        cancelJti,
        rescheduleJti,
        updatedAt: new Date(),
      })
      .where(eq(bookingRequest.id, inserted.bookingId));
  } catch (err) {
    console.error("[booking/create] attach event + jtis failed:", err);
    // Booking row + Google event both exist — degrade by returning the
    // booking id without a manage URL. User can still find their entry
    // via the confirmation page; cron in PR #44 retries the JTI write.
  }

  // 7. Send confirmation email synchronously --------------------------------
  const origin = getPublicOrigin(request);
  const manageToken = await signMagicLink(inserted.bookingId, "cancel", cancelJti);
  const manageUrl = `${origin}/book/manage/${encodeURIComponent(manageToken)}`;
  try {
    const email = buildBookingConfirmationEmail({
      prospectFirstName: firstNameFrom(body.name),
      slotStartLocal: formatSlotInTz(body.slotStartUtc, body.prospectTimezone),
      prospectTimezone: body.prospectTimezone,
      durationMinutes: consultant.slotMinutes,
      meetUrl: meetUrl ?? "(Meet link will arrive in a follow-up email)",
      manageUrl,
      recommendedReading: [],
    });
    const { resend, from } = await getResend();
    await resend.emails.send({
      from,
      to: body.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (err) {
    // Confirmation email failed — don't fail the booking. Log + carry on.
    // The user lands on the confirmation page; if needed they can
    // re-trigger the email from the manage page later.
    console.error("[booking/create] confirmation email failed:", err);
  }

  // 8. Enqueue follow-up scheduled jobs (skip confirmation — already sent) -
  try {
    await enqueueBookingJobs({
      bookingId: inserted.bookingId,
      slotStart: new Date(body.slotStartUtc),
      slotEnd: new Date(body.slotEndUtc),
      now: new Date(),
      excludeKinds: ["confirmation"],
    });
  } catch (err) {
    console.error("[booking/create] enqueue scheduled jobs failed:", err);
    // Reminders missing isn't fatal — the booking exists and the
    // synchronous confirmation went out. Operator can re-enqueue from
    // an admin tool later.
  }

  return NextResponse.json({
    ok: true,
    bookingId: inserted.bookingId,
    meetUrl,
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

// Pre-format the slot string for the confirmation email + UI. The
// booking-emails builder is string-formatting-free by design (D5
// comment: "the route handler does the Intl.DateTimeFormat conversion").
function formatSlotInTz(isoUtc: string, tz: string): string {
  try {
    const date = new Date(isoUtc);
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
    return isoUtc;
  }
}
