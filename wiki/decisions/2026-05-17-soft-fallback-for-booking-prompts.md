---
title: Booking prompts soft-fallback (vs diagnostic's hard-fail)
category: decision
created: 2026-05-17
updated: 2026-05-17
related: [[booking-prompts-in-db]], [[book-a-call-architecture]]
---

When the `booking_prompts` `site_setting` row is missing or malformed, the loader returns the hardcoded starter prompts (in `lib/booking-prompts-shared.ts`) instead of throwing. Booking continues at v1 quality. The diagnostic narrative prompt deliberately does the opposite — hard-fails on missing config.

## Decision

`lib/booking-prompts.ts`'s `getBookingPrompts()`:
- Row missing → return `BOOKING_PROMPTS_STARTER`
- Row malformed (Zod fails) → log warning + return starter
- DB unreachable → log warning + return starter
- Never throws.

`lib/diagnostic/prompt-config.ts`'s `getDiagnosticPrompt()`:
- Row missing → throw
- Row malformed → throw
- Never falls back.

## Why the split

The two AI surfaces serve different purposes:

**Diagnostic narrative** = the actual deliverable in the AI Readiness Assessment. The output IS the product the prospect pays for (well, the lead-magnet version of it). A generic LLM-default report would erode trust + make the AI Readiness funnel look fake. The right behaviour when the prompt isn't seeded is: refuse to ship a placeholder report. Hard-fail.

**Booking prompts** = operational augmentation. None of the three booking Claude calls produce a customer deliverable:
- Conversational intake follow-up is a UX nicety; a static form is a working v0
- Pre-call brief goes to the consultant, not the prospect; a "raw intake" fallback is enough
- Blog matching is a "while you wait" garnish; an empty reading list is fine

So when the booking_prompts row is missing/malformed, the booking flow should keep going at v1 quality, not refuse to accept the booking. Soft fallback.

## Why this is harder than it looks

The temptation is to apply one consistent pattern across the codebase ("all DB-backed prompts hard-fail on missing"). That would be wrong — the right pattern depends on what the consequence of fallback IS for that surface.

Test: ask "if this surface's AI augmentation disappeared tonight, what would the prospect see?"
- Diagnostic narrative: a broken report or no report. Bad. Hard-fail.
- Booking intake follow-up: a regular form. Fine. Soft-fallback.
- Pre-call brief: Rob walks into a call slightly less prepared. Manageable. Soft-fallback.
- Blog matching: confirmation email has no reading list. Unnoticeable. Soft-fallback.

The hardcoded starter prompts in `lib/booking-prompts-shared.ts` are the same prompts that were in `lib/claude-booking.ts` as string constants before PR #45 moved them to DB. They were running in production at v1 quality already; treating them as the runtime FLOOR (not just a UI placeholder) is honest.

## How the diagnostic version IS allowed to soft-fail

The diagnostic generator's only soft-fallback is at a different layer: when Claude itself times out / refuses / fails. In that case the report-generation route surfaces a "report unavailable, retry shortly" error to the user. NOT a fake placeholder. So even there, the principle holds: no degraded placeholder, only acknowledged unavailability.

## Consequences

- An admin who saves a corrupted booking_prompts row doesn't notice — the system silently falls back. The version-label "Starter" pill on `/admin/prompts` is the only visual signal. Acceptable; the soft-fallback IS the design.
- Admins iterating on booking prompts can experiment more freely — saving a bad prompt degrades quality but doesn't take the booking flow down.
- For diagnostic, the equivalent of "experimenting" requires the admin to be more careful, because a save-then-realise-bad means reports fail until they re-save.

## Code locations

- `lib/booking-prompts.ts` — the soft-fallback loader
- `lib/booking-prompts-shared.ts` — `BOOKING_PROMPTS_STARTER` (runtime floor)
- `lib/diagnostic/prompt-config.ts` — the hard-fail loader (contrast)
- `/admin/prompts` — surfaces the difference in card status pills
