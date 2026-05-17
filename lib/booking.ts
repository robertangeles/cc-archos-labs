import "server-only";

// Book-a-Call orchestration. Loads consultant config, queries availability,
// creates bookings end-to-end. Pure DB + helper coordination; no fetch /
// no Claude / no email rendering — those happen in the callers (route
// handlers) so this module stays testable.
//
// The big function here is `createBooking()` which atomically:
//   1. Validates the slot is still available (race protection)
//   2. Inserts booking_request with a deterministic idempotency_key
//   3. Returns the row so the route handler can call Google Calendar +
//      Resend in its own try/catch and update the row.
//
// Idempotency key is sha256(email|slotStart|5-min-bucket). The 5-minute
// bucket means two rapid double-submits collapse into one booking, but
// a legitimate "book another call later" submission gets its own key.
// booking_request.idempotency_key is UNIQUE, so race-safe at the DB layer.

import { createHash } from "node:crypto";
import { and, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import {
  generateSlots,
  workingHoursSchema,
  type AvailableSlot,
  type ConsultantConfig,
  type TimeInterval,
} from "./calendar";
import { getDb } from "./db";
import {
  bookingRequest,
  consultant,
  consultantBlackout,
} from "./db/schema";
import {
  BookingError,
  BookingStateError,
  BookingWindowError,
  GoogleAuthError,
  GoogleAuthErrorRevoked,
  SlotConflictError,
} from "./errors/booking";
import { getFreebusy } from "./google-calendar";

// ----------------------------------------------------------------------------
// Consultant lookup
// ----------------------------------------------------------------------------

export interface ConsultantRow {
  id: string;
  slug: string;
  displayName: string;
  // Internal routing address (OAuth identity, From: header on outgoing
  // emails). May be an alias inbox — not what we show publicly.
  email: string;
  // Branded public address surfaced on the booking page. Falls back to
  // `email` when unset.
  publicEmail: string | null;
  timezone: string;
  slotMinutes: number;
  slotBufferMinutes: number;
  advanceDays: number;
  minNoticeHours: number;
  workingHours: ConsultantConfig["workingHours"];
  googleCalendarId: string | null;
  googleStatus: "pending" | "ok" | "stale";
}

export async function getConsultantBySlug(
  slug: string,
): Promise<ConsultantRow | null> {
  const rows = await getDb()
    .select({
      id: consultant.id,
      slug: consultant.slug,
      displayName: consultant.displayName,
      email: consultant.email,
      publicEmail: consultant.publicEmail,
      timezone: consultant.timezone,
      slotMinutes: consultant.slotMinutes,
      slotBufferMinutes: consultant.slotBufferMinutes,
      advanceDays: consultant.advanceDays,
      minNoticeHours: consultant.minNoticeHours,
      workingHoursJson: consultant.workingHoursJson,
      googleCalendarId: consultant.googleCalendarId,
      googleStatus: consultant.googleStatus,
    })
    .from(consultant)
    .where(eq(consultant.slug, slug))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Validate the JSONB working_hours shape before exposing it. If the
  // admin saved a malformed blob, we'd rather fail loudly here than let
  // generateSlots see broken data.
  const workingHours = workingHoursSchema.parse(row.workingHoursJson);

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    email: row.email,
    publicEmail: row.publicEmail,
    timezone: row.timezone,
    slotMinutes: row.slotMinutes,
    slotBufferMinutes: row.slotBufferMinutes,
    advanceDays: row.advanceDays,
    minNoticeHours: row.minNoticeHours,
    workingHours,
    googleCalendarId: row.googleCalendarId,
    googleStatus: row.googleStatus as "pending" | "ok" | "stale",
  };
}

// ----------------------------------------------------------------------------
// Availability
// ----------------------------------------------------------------------------

export interface LoadAvailableSlotsInput {
  consultant: ConsultantRow;
  now: Date;
}

export interface LoadAvailableSlotsResult {
  slots: AvailableSlot[];
  // True if we successfully reached Google freebusy. False means we fell
  // back to "DB-only" availability — the page surfaces a soft warning
  // because the slot list may double-book against a calendar event we
  // couldn't see.
  freebusyOk: boolean;
}

export async function loadAvailableSlots(
  input: LoadAvailableSlotsInput,
): Promise<LoadAvailableSlotsResult> {
  const { consultant: c, now } = input;
  const fromMs = now.getTime();
  const toMs = fromMs + c.advanceDays * 86_400_000;

  // Blackouts overlapping the window.
  const blackoutRows = await getDb()
    .select({
      startAt: consultantBlackout.startAt,
      endAt: consultantBlackout.endAt,
    })
    .from(consultantBlackout)
    .where(
      and(
        eq(consultantBlackout.consultantId, c.id),
        gte(consultantBlackout.endAt, new Date(fromMs)),
        lte(consultantBlackout.startAt, new Date(toMs)),
      ),
    );
  const blackouts: TimeInterval[] = blackoutRows.map((b) => ({
    startUtc: b.startAt,
    endUtc: b.endAt,
  }));

  // Confirmed bookings overlapping the window. We exclude
  // 'cancelled' / 'rescheduled_from' so freed slots become available
  // again.
  const bookingRows = await getDb()
    .select({
      slotStart: bookingRequest.slotStart,
      slotEnd: bookingRequest.slotEnd,
    })
    .from(bookingRequest)
    .where(
      and(
        eq(bookingRequest.consultantId, c.id),
        eq(bookingRequest.status, "confirmed"),
        gte(bookingRequest.slotEnd, new Date(fromMs)),
        lte(bookingRequest.slotStart, new Date(toMs)),
      ),
    );
  const bookings: TimeInterval[] = bookingRows.map((b) => ({
    startUtc: b.slotStart,
    endUtc: b.slotEnd,
  }));

  // Google freebusy — soft-fail. If Google is unreachable / unauthorised,
  // we degrade to DB-only availability and signal the caller via
  // freebusyOk:false so the UI can warn.
  let freebusy: TimeInterval[] = [];
  let freebusyOk = false;
  if (c.googleStatus === "ok" && c.googleCalendarId) {
    try {
      const intervals = await getFreebusy({
        consultantId: c.id,
        calendarId: c.googleCalendarId,
        startUtc: new Date(fromMs).toISOString(),
        endUtc: new Date(toMs).toISOString(),
      });
      freebusy = intervals.map((i) => ({
        startUtc: new Date(i.startUtc),
        endUtc: new Date(i.endUtc),
      }));
      freebusyOk = true;
    } catch (err) {
      // GoogleAuthErrorRevoked already marked the consultant stale via
      // the calendar module. Other failures: log + degrade.
      if (!(err instanceof GoogleAuthErrorRevoked)) {
        console.warn(
          "[booking.loadAvailableSlots] freebusy failed — degrading to DB-only:",
          err,
        );
      }
    }
  }

  const slots = generateSlots({
    config: {
      timezone: c.timezone,
      slotMinutes: c.slotMinutes,
      slotBufferMinutes: c.slotBufferMinutes,
      advanceDays: c.advanceDays,
      minNoticeHours: c.minNoticeHours,
      workingHours: c.workingHours,
    },
    blackouts,
    bookings,
    freebusy,
    now,
  });

  return { slots, freebusyOk };
}

// ----------------------------------------------------------------------------
// Idempotency key
// ----------------------------------------------------------------------------

// Deterministic dedup key. Same email + same slot within a 5-minute
// window collapses to ONE booking via the unique constraint on
// booking_request.idempotency_key. A double-clicked submit button or a
// retried POST after a network blip can't create two rows.
export function computeIdempotencyKey(input: {
  email: string;
  slotStartUtc: Date;
}): string {
  const bucketMs = 5 * 60_000;
  const bucket = Math.floor(input.slotStartUtc.getTime() / bucketMs);
  const normalised = `${input.email.trim().toLowerCase()}|${bucket}`;
  return createHash("sha256").update(normalised).digest("hex");
}

// ----------------------------------------------------------------------------
// Create booking — input validation + insert
// ----------------------------------------------------------------------------

export const createBookingInputSchema = z.object({
  slotStartUtc: z.string().datetime({ offset: true }),
  slotEndUtc: z.string().datetime({ offset: true }),
  name: z.string().min(1).max(160),
  email: z.email().max(254),
  organisation: z.string().max(160).nullable(),
  position: z.string().max(160).nullable(),
  reasonInitial: z.string().min(1).max(2000),
  reasonFollowups: z
    .array(z.object({ question: z.string().max(500), answer: z.string().max(500) }))
    .max(2)
    .default([]),
  prospectTimezone: z.string().min(1).max(80),
  utm: z
    .object({
      source: z.string().max(160).nullish(),
      medium: z.string().max(160).nullish(),
      campaign: z.string().max(160).nullish(),
      content: z.string().max(160).nullish(),
      term: z.string().max(160).nullish(),
      referrer: z.string().max(500).nullish(),
    })
    .default({}),
});

export type CreateBookingInput = z.infer<typeof createBookingInputSchema>;

export interface CreateBookingResult {
  bookingId: string;
  idempotencyKey: string;
  // "created"        — new row inserted by this call
  // "exists_confirmed" — prior submit succeeded, booking is fully ready
  //                    (Google event + jtis + email all done). Route
  //                    should short-circuit to confirmation page.
  // "exists_pending_sync" — prior submit inserted the row but Google
  //                    failed at the event-creation step. Route should
  //                    retry steps 5-8 (Google + email + enqueue).
  status: "created" | "exists_confirmed" | "exists_pending_sync";
}

// Insert a booking_request row, race-safe via the unique idempotency_key.
// Caller (route handler) then creates the Google Calendar event +
// enqueues scheduled jobs + sends the confirmation email synchronously.
// Slot-window validation is the caller's responsibility — we trust the
// availability route returned only valid slots, but the unique
// consultant_id + slot_start guarantees no double-book against
// confirmed bookings already in the DB.
export async function createBookingRow(input: {
  consultantId: string;
  validated: CreateBookingInput;
  now: Date;
}): Promise<CreateBookingResult> {
  const { consultantId, validated, now } = input;
  const slotStart = new Date(validated.slotStartUtc);
  const slotEnd = new Date(validated.slotEndUtc);

  // Window sanity — the page shouldn't have offered an out-of-bounds slot,
  // but guard against tampered POSTs.
  if (slotEnd.getTime() <= slotStart.getTime()) {
    throw new BookingWindowError("slotEnd must be after slotStart");
  }
  if (slotStart.getTime() <= now.getTime()) {
    throw new BookingWindowError("slot is in the past");
  }

  const idempotencyKey = computeIdempotencyKey({
    email: validated.email,
    slotStartUtc: slotStart,
  });

  const db = getDb();

  // Check for an existing row with the same idempotency key — second
  // identical submit returns the original row but with a status flag
  // so the route handler can decide whether to retry the Google /
  // email steps (when the prior attempt left the booking in
  // pending_calendar_sync) or short-circuit to the confirmation page.
  const existing = await db
    .select({
      id: bookingRequest.id,
      status: bookingRequest.status,
    })
    .from(bookingRequest)
    .where(eq(bookingRequest.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing[0]) {
    return {
      bookingId: existing[0].id,
      idempotencyKey,
      status:
        existing[0].status === "pending_calendar_sync"
          ? "exists_pending_sync"
          : "exists_confirmed",
    };
  }

  // Race-guard: another confirmed booking at the same slot?
  const conflict = await db
    .select({ id: bookingRequest.id })
    .from(bookingRequest)
    .where(
      and(
        eq(bookingRequest.consultantId, consultantId),
        eq(bookingRequest.status, "confirmed"),
        eq(bookingRequest.slotStart, slotStart),
      ),
    )
    .limit(1);
  if (conflict[0]) {
    throw new SlotConflictError(
      "Slot was taken between availability check and submit. Refresh and pick another.",
    );
  }

  const inserted = await db
    .insert(bookingRequest)
    .values({
      consultantId,
      name: validated.name,
      email: validated.email,
      organisation: validated.organisation ?? null,
      position: validated.position ?? null,
      reasonInitial: validated.reasonInitial,
      reasonFollowups: validated.reasonFollowups,
      slotStart,
      slotEnd,
      prospectTimezone: validated.prospectTimezone,
      status: "confirmed",
      utmSource: validated.utm.source ?? null,
      utmMedium: validated.utm.medium ?? null,
      utmCampaign: validated.utm.campaign ?? null,
      utmContent: validated.utm.content ?? null,
      utmTerm: validated.utm.term ?? null,
      referrer: validated.utm.referrer ?? null,
      idempotencyKey,
    })
    .returning({ id: bookingRequest.id });

  if (!inserted[0]) {
    // Postgres confirmed insert returned no row — extremely unusual,
    // treat as an internal error so the route can return 500.
    throw new BookingError("Booking insert returned no row");
  }

  return { bookingId: inserted[0].id, idempotencyKey, status: "created" };
}

// Update the booking row with the Google event id + Meet URL once the
// calendar event creation succeeds. Separate transaction so a Google
// failure doesn't block the initial insert. Always sets status back
// to 'confirmed' — if this is a retry of a pending_calendar_sync
// booking, that flip clears the "sync delayed" banner on the
// confirmation page.
export async function attachGoogleEvent(input: {
  bookingId: string;
  googleEventId: string;
  meetUrl: string | null;
  now: Date;
}): Promise<void> {
  await getDb()
    .update(bookingRequest)
    .set({
      googleEventId: input.googleEventId,
      meetUrl: input.meetUrl,
      status: "confirmed",
      updatedAt: input.now,
    })
    .where(eq(bookingRequest.id, input.bookingId));
}

// ----------------------------------------------------------------------------
// Manage flow — magic-link token verification + cancel + reschedule
// ----------------------------------------------------------------------------
//
// The confirmation email carries a JWT signed with AUTH_SECRET that
// embeds the booking id + a single-use jti. The manage page + the
// cancel/reschedule routes hand that token here to (a) verify the
// signature and expiry, and (b) confirm the jti still matches the
// booking's stored cancel_jti — which means the token hasn't already
// been consumed by a prior cancel or supplanted by a reschedule.

import {
  generateJti,
  signMagicLink,
  verifyMagicLink,
} from "./jwt-magic-link";
import { JWTRevokedError } from "./errors/booking";

export interface VerifiedManageContext {
  bookingId: string;
  // The booking row, minus a few columns the routes/pages don't need.
  // Drizzle won't infer "fewer columns" from select(), so we type
  // exactly what the verifier returns.
  booking: {
    id: string;
    consultantId: string;
    name: string;
    email: string;
    organisation: string | null;
    position: string | null;
    reasonInitial: string;
    reasonFollowups: unknown;
    slotStart: Date;
    slotEnd: Date;
    prospectTimezone: string;
    status: string;
    googleEventId: string | null;
    meetUrl: string | null;
    cancelJti: string | null;
    rescheduleJti: string | null;
  };
  consultant: ConsultantRow;
}

// Verify the manage token + jti. Throws JWTInvalidError /
// JWTExpiredError / JWTRevokedError on auth failure. Throws
// BookingError if the booking row is missing or its consultant is
// unreachable.
//
// `expectedKind` defaults to 'cancel' because PR #42 only mints cancel
// tokens (the confirmation email's manage URL embeds one). A future
// flow that surfaces a 'reschedule' token can verify with that kind.
export async function verifyManageToken(input: {
  token: string;
  expectedKind?: "cancel" | "reschedule";
}): Promise<VerifiedManageContext> {
  const payload = await verifyMagicLink(input.token);
  const expectedKind = input.expectedKind ?? "cancel";
  if (payload.kind !== expectedKind) {
    throw new JWTRevokedError(
      `Token kind mismatch (got ${payload.kind}, expected ${expectedKind})`,
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      id: bookingRequest.id,
      consultantId: bookingRequest.consultantId,
      name: bookingRequest.name,
      email: bookingRequest.email,
      organisation: bookingRequest.organisation,
      position: bookingRequest.position,
      reasonInitial: bookingRequest.reasonInitial,
      reasonFollowups: bookingRequest.reasonFollowups,
      slotStart: bookingRequest.slotStart,
      slotEnd: bookingRequest.slotEnd,
      prospectTimezone: bookingRequest.prospectTimezone,
      status: bookingRequest.status,
      googleEventId: bookingRequest.googleEventId,
      meetUrl: bookingRequest.meetUrl,
      cancelJti: bookingRequest.cancelJti,
      rescheduleJti: bookingRequest.rescheduleJti,
    })
    .from(bookingRequest)
    .where(eq(bookingRequest.id, payload.bid))
    .limit(1);
  const booking = rows[0];
  if (!booking) {
    throw new JWTRevokedError(`Booking ${payload.bid} not found`);
  }

  // jti revocation check. The jti stamped on the booking row is the
  // single source of truth — if it's been cleared (cancel happened) or
  // rotated (reschedule happened), the link is dead.
  const expectedJti =
    expectedKind === "cancel" ? booking.cancelJti : booking.rescheduleJti;
  if (!expectedJti || expectedJti !== payload.jti) {
    throw new JWTRevokedError(
      "Token has already been used or superseded by a reschedule",
    );
  }

  const consultant = await getConsultantById(booking.consultantId);
  if (!consultant) {
    throw new BookingError(
      `Consultant ${booking.consultantId} not found for booking ${booking.id}`,
    );
  }

  return { bookingId: booking.id, booking, consultant };
}

// Load consultant by id — sister to getConsultantBySlug. Keeps the
// query column list in one place.
async function getConsultantById(id: string): Promise<ConsultantRow | null> {
  const rows = await getDb()
    .select({
      id: consultant.id,
      slug: consultant.slug,
      displayName: consultant.displayName,
      email: consultant.email,
      publicEmail: consultant.publicEmail,
      timezone: consultant.timezone,
      slotMinutes: consultant.slotMinutes,
      slotBufferMinutes: consultant.slotBufferMinutes,
      advanceDays: consultant.advanceDays,
      minNoticeHours: consultant.minNoticeHours,
      workingHoursJson: consultant.workingHoursJson,
      googleCalendarId: consultant.googleCalendarId,
      googleStatus: consultant.googleStatus,
    })
    .from(consultant)
    .where(eq(consultant.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const workingHours = workingHoursSchema.parse(row.workingHoursJson);
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    email: row.email,
    publicEmail: row.publicEmail,
    timezone: row.timezone,
    slotMinutes: row.slotMinutes,
    slotBufferMinutes: row.slotBufferMinutes,
    advanceDays: row.advanceDays,
    minNoticeHours: row.minNoticeHours,
    workingHours,
    googleCalendarId: row.googleCalendarId,
    googleStatus: row.googleStatus as "pending" | "ok" | "stale",
  };
}

// Mark a booking cancelled in the DB and revoke its magic-link jtis.
// Caller is responsible for the side-effects: deleting the Google
// event, sending the cancellation email, cancelling pending scheduled
// jobs. Splitting "DB state change" from "side effects" keeps the
// route handler in control of error recovery — if Google delete fails,
// the DB is already correct and the operator can manually clean up.
export async function markBookingCancelled(input: {
  bookingId: string;
  now: Date;
}): Promise<void> {
  await getDb()
    .update(bookingRequest)
    .set({
      status: "cancelled",
      // Single-use: clear the jtis so neither magic link works again.
      cancelJti: null,
      rescheduleJti: null,
      updatedAt: input.now,
    })
    .where(eq(bookingRequest.id, input.bookingId));
}

// Mark a booking as superseded by a new one. Used by the reschedule
// flow on the OLD booking row — the new row gets its own create-time
// inserts via createBookingRow.
export async function markBookingRescheduled(input: {
  oldBookingId: string;
  newBookingId: string;
  now: Date;
}): Promise<void> {
  await getDb()
    .update(bookingRequest)
    .set({
      status: "rescheduled_from",
      rescheduledToId: input.newBookingId,
      cancelJti: null,
      rescheduleJti: null,
      updatedAt: input.now,
    })
    .where(eq(bookingRequest.id, input.oldBookingId));
}

// Mint fresh cancel + reschedule jtis for a booking. Used by the
// reschedule flow's new-booking step. The cancel token is returned so
// the route can build the manage URL embedded in the new confirmation
// email.
export async function mintBookingJtis(input: {
  bookingId: string;
  now: Date;
}): Promise<{ cancelToken: string; cancelJti: string; rescheduleJti: string }> {
  const cancelJti = generateJti();
  const rescheduleJti = generateJti();
  const cancelToken = await signMagicLink(input.bookingId, "cancel", cancelJti);
  await getDb()
    .update(bookingRequest)
    .set({
      cancelJti,
      rescheduleJti,
      updatedAt: input.now,
    })
    .where(eq(bookingRequest.id, input.bookingId));
  return { cancelToken, cancelJti, rescheduleJti };
}

// Re-export named errors that route handlers narrow on for typed
// responses. Keeps the error surface clear at call sites.
export {
  BookingError,
  BookingStateError,
  BookingWindowError,
  GoogleAuthError,
  SlotConflictError,
};
