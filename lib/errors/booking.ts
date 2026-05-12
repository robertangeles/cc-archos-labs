// Named error classes for the Book-a-Call subsystem. Route handlers and
// the cron job narrow with `instanceof` to decide retry / rescue / alert
// behaviour. A catch-all `if (err instanceof BookingError)` covers the
// unknown without swallowing native runtime errors.
//
// Every catch in lib/calendar.ts, lib/google-calendar.ts, lib/scheduler.ts,
// and the booking API routes must narrow to one of these classes — never
// `catch (e)` without a specific match. See plan §6 (Error & Rescue
// Registry) for the full mapping of failure → exception → rescue action.

export class BookingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

// ---- Google Calendar / Google OAuth -----------------------------------------

export class GoogleAuthError extends BookingError {}
// Specifically signals the refresh token was rejected (user revoked
// grant). Distinguished from GoogleAuthError because the rescue is
// different: mark consultant.google_status='stale' and alert Rob to
// re-grant, rather than retry.
export class GoogleAuthErrorRevoked extends GoogleAuthError {}
export class GoogleRateLimitError extends BookingError {}
export class GoogleServerError extends BookingError {}

// ---- Claude / OpenRouter ----------------------------------------------------

export class ClaudeParseError extends BookingError {}
export class ClaudeRefusalError extends BookingError {}
export class ClaudeRateLimitError extends BookingError {}

// ---- Booking lifecycle ------------------------------------------------------

// Returned by /api/booking/create when the chosen slot was taken between
// the prospect viewing availability and submitting. UI catches this and
// shows the slot-taken modal with refreshed slot list (D9).
export class SlotConflictError extends BookingError {}
// Returned when the prospect's chosen slot violates the booking window
// (too far in advance, too short notice, outside working hours, blackout).
// Should not normally happen because the UI hides those slots, but a
// race window exists between admin editing config and the page rendering.
export class BookingWindowError extends BookingError {}
// Returned when an action targets a booking in a state that disallows
// the action — e.g. cancelling an already-cancelled booking. The handler
// returns 409 and renders an idempotent-success page rather than failing.
export class BookingStateError extends BookingError {}

// ---- Magic-link JWTs --------------------------------------------------------

export class JWTInvalidError extends BookingError {}
export class JWTExpiredError extends BookingError {}
// Token signature was valid but its jti is in the revoked set (consumed
// already, or superseded by a later reschedule). Distinguished from
// invalid so the UI can show "this link was already used" rather than
// the alarming "link invalid".
export class JWTRevokedError extends BookingError {}

// ---- Crypto -----------------------------------------------------------------

// Wraps AES-GCM auth failures (tamper detected) and missing-key errors
// from lib/booking-crypto.ts. Tamper failures emit a security [ALERT]
// email per plan §3 threat model.
export class CryptoError extends BookingError {}

// ---- Anti-spam --------------------------------------------------------------

export class TurnstileError extends BookingError {}
export class HoneypotError extends BookingError {}
