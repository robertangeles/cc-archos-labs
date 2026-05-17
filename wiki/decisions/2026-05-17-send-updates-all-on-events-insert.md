---
title: Google events.insert uses sendUpdates=all for the .ics invite
category: decision
created: 2026-05-17
updated: 2026-05-17
related: [[book-a-call-architecture]], [[2026-05-17-google-send-updates-required-for-ics]]
---

Every booking-create call passes `sendUpdates=all` on Google Calendar's `events.insert`. Without it, attendees get no .ics invite email — just our branded Resend confirmation.

## Decision

`sendUpdates=all` on every event creation. Attendees get both Google's native invite (.ics attached, Yes/No/Maybe buttons, "Add to calendar" affordance) **and** our branded Resend confirmation (manage link, prep brief framing).

NOT: rely on our Resend confirmation alone.

## Why

Bookings are calendar events. The .ics invite is the canonical way calendar events are delivered:
- Attendee's inbox shows the standard "X has invited you to..." card with one-click Accept/Decline
- Attendee's calendar app auto-populates the event on Accept
- Out-of-band reschedules / cancellations sync via the standard iCal flow (Google handles this)

Our Resend confirmation does different work — it carries the manage URL (magic-link cancel/reschedule), the prep framing ("Rob will read your intake before the call"), and brand voice. Different purpose; complementary.

Both fire on the same `events.insert` because `sendUpdates=all` is set in the API call query param. No race between them.

## How we found out

PR #42 originally shipped without `sendUpdates=all`. The test booking landed the Resend email but no .ics. Took ~30 min to track down — Google's `events.insert` defaults to `sendUpdates=none` (no attendee email). Adding the query param fixed it in one line.

Documented as a lesson at [[2026-05-17-google-send-updates-required-for-ics]] so future-us doesn't relearn it.

## Consequences

- **Two confirmation emails per booking** — accepted; they serve different purposes.
- **Google's email arrives from the consultant's calendar address** (the OAuth-granted account), not from our `hello@mail.archoslabs.xyz`. Higher trust signal (real Google calendar invite), though it slightly fragments the "all communication is from Archos Labs" narrative. Acceptable trade — this is industry standard.
- **Cancel + reschedule must also use `sendUpdates=all`** — same pattern. `deleteEvent` takes a `notifyAttendees` parameter; we pass true on cancel. `updateEventTime` (patch) hardcodes `sendUpdates=all`.

## Code locations

- `lib/google-calendar.ts` line ~370 — `createEvent` sets `url.searchParams.set("sendUpdates", "all")`
- `lib/google-calendar.ts` line ~435 — `updateEventTime` (patch) sets the same
- `lib/google-calendar.ts` line ~485 — `deleteEvent` conditionally sets `sendUpdates=all` based on `notifyAttendees` arg; cancel route passes `true`
