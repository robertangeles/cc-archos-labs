---
title: Google events.insert needs sendUpdates=all to email the .ics invite
category: lesson
created: 2026-05-17
updated: 2026-05-17
related: [[2026-05-17-send-updates-all-on-events-insert]], [[book-a-call-architecture]]
---

`events.insert` on Google Calendar does NOT send an attendee invite email by default. Without `sendUpdates=all` in the query string, the event lands on the consultant's calendar but no .ics goes to the attendee's inbox. This bit us mid-PR-#42 — first booking shipped a Resend confirmation but the prospect got no calendar invite from Google.

## Problem

We were creating events via `POST /calendars/{id}/events` with `conferenceData.createRequest` (the Meet-link trick) and attendees array populated. Test booking succeeded: row in `booking_request`, event on Rob's calendar, Resend confirmation in inbox. But no .ics invite, no Yes/No/Maybe email, no "Add to calendar" affordance.

Reading Google's API docs: `events.insert` accepts a `sendUpdates` query param with values `all`, `externalOnly`, `none`. Default is `none`. "All" sends to all attendees + the calendar owner; "externalOnly" sends only to attendees not on the owner's domain; "none" silently creates the event.

We needed `all` and didn't set it.

## Fix

One-line change in `lib/google-calendar.ts` `createEvent`:

```ts
const url = new URL(`${CALENDAR_BASE}/calendars/${...}/events`);
url.searchParams.set("conferenceDataVersion", "1");
url.searchParams.set("sendUpdates", "all"); // ← this line
```

Same fix applies to `events.patch` (reschedule). `events.delete` already used `sendUpdates=all` conditionally — kept that pattern.

## Rule

When Google Calendar emails are part of the user-facing flow (which they are for any booking system), `sendUpdates=all` is non-negotiable. Default is silent.

## Watch out for

The "consultant is their own attendee" case can hide this bug if the consultant is the only attendee in your test. Their calendar populates automatically (it's their event), so the event appears on their calendar even without sendUpdates. The .ics email going missing is only visible when the attendee != the calendar owner. **Always test with a separate attendee email** — i.e. submit a booking with a different email than the one that owns the OAuth grant.

## Also watch out for

Google's email system de-duplicates rapid invite/cancel pairs on the same attendee. We discovered this in PR #43's first reschedule implementation (delete-old + create-new) — the cancellation email arrived but the new invite never did. Documented at [[2026-05-17-google-suppresses-rapid-invite-cancel]]. The fix there is to use `events.patch` instead of delete+create.
