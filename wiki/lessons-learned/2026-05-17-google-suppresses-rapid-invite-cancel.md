---
title: Google suppresses rapid invite + cancel pairs on the same attendee
category: lesson
created: 2026-05-17
updated: 2026-05-17
related: [[2026-05-17-patch-in-place-reschedule]], [[2026-05-17-google-send-updates-required-for-ics]]
---

If you create a calendar event and delete a different one for the same attendee within a short window, Google's email system fires the cancellation but suppresses the new invite. Observed empirically while testing PR #43's first reschedule implementation.

## Problem

PR #43's original reschedule flow was:

1. Insert a new `booking_request` row with the new slot
2. Call `events.insert` (with `sendUpdates=all`) to create the new Google event
3. Call `events.delete` (with `sendUpdates=all`) on the OLD event
4. Transition the old `booking_request` row to `rescheduled_from`

Test reschedule: a real prospect (with a separate Gmail) got the cancellation email for the old time. They did NOT get a new invite email for the new time. Google's calendar UI showed both — the old as cancelled, the new as new — but the attendee's INBOX only had the cancellation.

Reproducible across attempts.

## Probable cause

Google's notification system appears to dedupe rapid event changes affecting the same attendee. When `events.insert` (new invite) and `events.delete` (cancel) both target the same attendee and fire within the same minute (and both have `sendUpdates=all`), Google's heuristic seems to be: "the attendee is being noisy-updated, send only the most consequential email" — which it interprets as the cancel.

This isn't documented in Google's Calendar API docs (at least not anywhere I could find). It's emergent behaviour from their email batching / spam-protection layer.

## Fix

Don't delete-and-recreate. Use `events.patch` to MOVE the existing event in place. Single API call, single email ("Event updated" — a hybrid invite-with-new-times that Google handles natively). Preserves the event id, fires `sendUpdates=all` → fresh .ics with new times, RSVP state preserved.

PR #43's second commit refactored to this pattern. Documented as a decision at [[2026-05-17-patch-in-place-reschedule]].

## Rule

**Reschedule = patch. Cancel = delete. Don't combine them.**

If you find yourself reaching for delete-then-create on the same attendee, ask whether `events.patch` would do the job. For booking systems, the answer is yes 95% of the time. The 5% where it isn't: switching to a fundamentally different event type (e.g. converting a 30-min call to a 2-hour workshop where you want the attendee to explicitly re-accept). For those, the cancel+create is the right semantics, and the suppressed invite is acceptable.

## Knock-on effect on schema design

The `booking_request` table has a `rescheduled_from` status and a self-FK `rescheduled_to_id` column from the original delete-and-recreate design. Both stay in the schema (cheap to keep) but are unused by the v2 patch flow. Future "convert booking to workshop" type flows could reuse them.

## Watch out for

When debugging this, the "Calendar UI shows both events correctly" can mislead you into thinking the flow is fine. The user-facing failure is INBOX state, not calendar state. Always check the recipient's actual inbox, not just their calendar app.
