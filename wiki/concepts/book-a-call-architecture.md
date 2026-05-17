---
title: Book-a-Call architecture
category: concept
created: 2026-05-17
updated: 2026-05-17
related: [[booking-prompts-in-db]], [[claude-eval-suites]], [[integration-config]], [[transactional-email-rendering]]
---

How a prospect goes from "thinking about it" on the home page to a Google Meet 30 minutes later. The pipeline runs autonomously after booking — no human in the loop until the call itself.

## The path

1. Home page CTA (`/`) → `/book/archos-labs`
2. Prospect picks a slot from the live availability picker
3. Form intake: name, email, organisation, role, reason. Claude asks one sharpening question on blur (2-turn cap, fallback to static if Claude unavailable). Turnstile + honeypot before submit.
4. POST `/api/booking/[slug]/create` — atomic create: insert `booking_request` row → Google Calendar `events.insert` (with `sendUpdates=all` so attendee gets the .ics invite) → mint cancel/reschedule JTIs → send our branded confirmation via Resend → enqueue 5 follow-up scheduled jobs (excluding confirmation, which was sent synchronously).
5. Render Cron hits `/api/cron/process-scheduled` every minute. Authenticated via `CRON_SECRET`. FOR UPDATE SKIP LOCKED dequeues up to 20 due jobs per run.
6. Dispatch per job kind:
   - `reminder_24h` — Resend email to prospect
   - `precall_brief` — Claude generates priority + summary + 3 talking points → Resend to **consultant**
   - `reminder_1h` — Resend email to prospect (Meet link)
   - `postcall_followup` — Resend email to prospect
   - `noshow_recovery` — only fires if booking status is `no_show` (admin sets manually)
7. Prospect optionally clicks the manage link in the confirmation email → `/book/manage/[token]` → cancel or reschedule. Reschedule uses Google `events.patch` to move the event in place (preserves event id, single "Event updated" notification — see [[2026-05-17-patch-in-place-reschedule]]).

## Components and their files

| Surface | File | Notes |
|---|---|---|
| Slot math | `lib/calendar.ts` | Pure function. Works in consultant tz via `Intl.DateTimeFormat`. DST handled by walking UTC grid, resolving each instant's wall clock. |
| Queue dispatch | `lib/scheduler.ts` | `planBookingJobs` + DB wrappers. FOR UPDATE SKIP LOCKED via Drizzle `.for("update", { skipLocked: true })`. Max 3 attempts, 5-min lock TTL. |
| Google Calendar | `lib/google-calendar.ts` | `events.insert` / `events.patch` / `events.delete` + freebusy. Access-token cache busts on reconnect (PR #41 fix). `sendUpdates=all` on insert + patch is what triggers the .ics invite. |
| Claude prompts | `lib/claude-booking.ts` | Three prompts loaded from DB via `getBookingPrompts()` ([[booking-prompts-in-db]]). Soft-fallback to hardcoded starters. |
| JSON recovery | `lib/claude.ts` | `extractBalancedJsonObjects` handles prose-contaminated responses (PR #48). |
| Cron dispatch | `lib/cron-dispatch.ts` | One handler per scheduled_job kind. Universal skip on non-confirmed status (except `noshow_recovery` which checks for `no_show`). |
| Public booking | `app/book/[slug]/page.tsx` + `booking-form.tsx` | Server-renders consultant header; client island handles slot picker + intake form. |
| Manage flow | `app/book/manage/[token]/...` | Token-gated cancel + reschedule. Reschedule reuses the calendar picker via `components/booking/calendar-picker.tsx`. |
| Cron route | `app/api/cron/process-scheduled/route.ts` | Bearer-token auth via `CRON_SECRET`. Hit by Render Cron every minute. |
| Health | `app/api/health/cron/route.ts` | Public read of `cron_heartbeat`. Returns 503 if stale (>10 min). UptimeRobot-friendly. |

## Tables

`consultant` — `slug`, `displayName`, `email` (internal routing), `public_email` (rendered publicly — see [[2026-05-17-public-email-split]]), `timezone`, slot config, working_hours_json, Google grant (refresh token encrypted via AES-GCM).

`booking_request` — one row per attempted booking. Fields include slot times, prospect metadata, status (`confirmed` | `pending_calendar_sync` | `cancelled` | `rescheduled_from` | `completed` | `no_show`), Google event id, Meet URL, cancel/reschedule JTIs, per-kind `*_sent_at` columns for dedup, idempotency_key (UNIQUE — race-safe creates).

`scheduled_job` — outbox queue. `(kind, booking_id, due_at, status, attempts, locked_by, locked_until, last_error)`. Composite index on `(status, due_at)` serves the cron poller.

`cron_heartbeat` — single row with `id = 'singleton'`. Cron writes after each run; health endpoint reads.

## State machines

**`booking_request.status`**:
- `confirmed` (default on create) → `cancelled` | `rescheduled_from` | `completed` | `no_show`
- `pending_calendar_sync` ← transient, set when Google insert fails post-row-insert. The next idempotent submit retries the Google call.
- `rescheduled_from` is a leaf state — `rescheduledToId` points at the new row. (NOTE: PR #43's patch-in-place reschedule means this status mostly stays unused now; same row gets edited rather than supersede via this status flag.)

**`scheduled_job.status`**:
- `pending` → `processing` (via dequeueBatch) → `sent` | `failed` | `skipped`
- `pending → skipped` at enqueue time if `due_at < now` for non-confirmation kinds (avoids firing a 24h reminder for a booking made 30min before slot_start).
- Recover-stale-locks at cron tick start moves rows from `processing` (with `locked_until < now`) back to `pending`.

## Soft vs hard failure modes

The system is built to **degrade gracefully**, not crash, when AI surfaces fail. Each Claude call has a soft-fallback:

- Conversational intake follow-up Claude failure → static intake form (no follow-up question shown, booking still proceeds)
- Pre-call brief Claude failure → "raw intake" email built from the prospect's exact reason (consultant still gets info, just less curated)
- Blog matching Claude failure → confirmation email omits the "while you wait" reading list

The PRINCIPLE: revenue path stays alive (booking submits, calendar event created, prospect gets confirmation) even when the AI augmentation can't. Tested in PR #44.

The diagnostic narrative prompt is the exception — it hard-fails on missing config, because the AI Readiness report has no degraded version that's worth sending. See [[booking-prompts-in-db]] for why this distinction matters.

## Cost discipline

Each booking costs ~$0.005–$0.01 in Claude calls (conversational follow-up + pre-call brief; blog matching not wired yet). Per-call cost is tracked in `scheduled_job.claude_cost_usd` and summed into `booking_request.claude_cost_usd_total`. No hard budget cap yet — would land as an alert at 80% / 100% of a monthly budget figure when the system has real volume.

## Anti-abuse

The public booking page is rate-protected by:
1. Honeypot field (`website` — must be empty)
2. Cloudflare Turnstile (when configured — site key + secret key both required, see [[2026-05-17-asymmetric-turnstile-config]])
3. Idempotency key prevents duplicate bookings within a 5-minute window for the same email + slot

## What still needs operator setup

After code ships, prod needs:
1. Migrations 0006–0009 applied (`pnpm db:migrate` against prod `DATABASE_URL`)
2. `CRON_SECRET` env var on Render
3. Render Cron Job: `* * * * *` → `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://www.archoslabs.xyz/api/cron/process-scheduled`
4. Reconnect Google on prod via `/admin/integrations/google-calendar` (new `calendar.freebusy` scope from PR #41 polish)
5. Paste Turnstile keys at `/admin/integrations/anti-spam`
6. Save the 4 prompts at `/admin/prompts` (booking prompts fall back to starters but the diagnostic narrative requires a configured row)
7. (Optional) UptimeRobot on `/api/health/cron`

## What's deliberately not shipped

- Admin button to mark a booking as `no_show` (currently has to be done in psql / Drizzle Studio — `noshow_recovery` email skips correctly until then)
- Admin button to mark a booking as `completed` — `postcall_followup` still fires regardless, but analytics can't distinguish completed vs no_show without it
- Blog library + matching wired into the confirmation email (`matchBlogPosts` exists, prompt exists, library doesn't)
- Multi-consultant — schema supports it (consultant.slug is unique, every booking row carries consultant_id) but only one row exists today and the OAuth callback keys identity on integration_secrets.contactRecipientEmail
- Consultant profile UI in `/admin` — admin can't edit timezone, working hours, slug, displayName, public_email without psql today

All five are mechanical follow-ups when the business asks for them.
