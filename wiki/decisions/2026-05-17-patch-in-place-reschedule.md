---
title: Patch-in-place reschedule — events.patch over delete + create
category: decision
created: 2026-05-17
updated: 2026-05-17
related: [[book-a-call-architecture]], [[2026-05-17-google-suppresses-rapid-invite-cancel]]
---

When a prospect reschedules a booking, we move the existing Google Calendar event in place via `events.patch` instead of deleting the old and creating a new event. The booking_request row stays the same row; only slot times + JTIs rotate.

## Decision

Reschedule = **one** Google Calendar PATCH + **one** `booking_request` row UPDATE.

NOT: delete old event + create new event + insert new booking_request row + set old row to `rescheduled_from`.

## Why

The original PR #43 implementation did delete-and-recreate. Smoke testing surfaced two problems:

1. **Google suppresses the new .ics invite** when a cancel+invite pair fires on the same attendee within a short window. Observed empirically: cancellation email arrives, new invite email never does. The attendee's calendar updates correctly but they don't get a fresh .ics in their inbox. ([[2026-05-17-google-suppresses-rapid-invite-cancel]] for the bigger lesson.)
2. **Two emails for one logical action** is worse UX than one. The attendee sees "Event cancelled" then "Event created" instead of the obvious "Event updated".

`events.patch` with `sendUpdates=all` fires Google's native "Event updated" email — single notification with a fresh .ics attached, RSVP state preserved, event id stable. This is what Calendly + Cal.com do; we just briefly went off-pattern.

## What changed in the schema

Nothing. The schema still supports the cancel-and-create flow via `status='rescheduled_from'` + `rescheduledToId` self-FK. It's just unused now — the column stays available for a hypothetical future flow that genuinely needs two distinct rows (e.g. "rebook after no-show").

## Consequences

- **Audit trail is lossy**: the old slot_start/slot_end is overwritten on the same row, so we lose the "this booking was originally at X" history. Acceptable for v1; a `booking_history` table is a clean follow-up if we need it.
- **Reschedule is a single transaction**: easier reasoning, no half-committed state where a new row exists but the old hasn't been transitioned.
- **The cancel_jti rotates** on reschedule. Old manage link in the confirmation email becomes dead; new manage link in the reschedule confirmation email is the new way in. Single-use semantics preserved.
- **Scheduled jobs are cancel-and-re-enqueue**: pending reminders/brief/followup jobs for the old slot get marked `skipped`, and fresh jobs are inserted for the new slot. No double-firing.

## Code locations

- `lib/google-calendar.ts` — `updateEventTime()` (events.patch + sendUpdates=all)
- `lib/booking.ts` — `rescheduleBookingSlot()` (in-place row update)
- `app/api/booking/reschedule/route.ts` — the orchestrator

## When this would change

If the business wanted to expose "rescheduled" as a first-class concept in analytics (e.g. "show me bookings that were rescheduled at least once"), we'd add a `booking_history` table that captures each slot change. The current model only knows the current slot.
