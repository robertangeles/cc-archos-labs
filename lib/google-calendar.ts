import "server-only";

// Google Calendar API client for the Book-a-Call pipeline. Wraps three
// endpoints we need:
//
//   1. freeBusy.query        — read Rob's busy intervals for slot
//                              generation (lib/calendar.ts uses this)
//   2. events.insert         — create a calendar event with a Meet link
//                              via conferenceData.createRequest
//   3. events.delete         — cancel a calendar event on
//                              cancel/reschedule
//
// Auth strategy (plan §18.1 + D6a):
//   - Refresh token lives in consultant.google_refresh_token_encrypted,
//     AES-GCM encrypted via lib/booking-crypto.ts.
//   - Access tokens cached in-memory per consultantId with a 5-min
//     expiry skew. Refreshed reactively when expired.
//   - On 401 despite a valid cache (token revoked server-side), refresh
//     once and retry; on second 401, mark consultant.google_status='stale'
//     and throw GoogleAuthErrorRevoked so the route can alert Rob.
//
// freeBusy cache: 60s in-memory LRU (max 100 entries) keyed by
// `${consultantId}:${start}:${end}` per plan §18.1 perf fix. Callers in
// lib/scheduler.ts invalidate when a booking lands so the next
// availability query sees the new conflict.

import { eq } from "drizzle-orm";
import { decrypt } from "./booking-crypto";
import { getDb } from "./db";
import { consultant } from "./db/schema";
import {
  BookingError,
  GoogleAuthError,
  GoogleAuthErrorRevoked,
  GoogleRateLimitError,
  GoogleServerError,
} from "./errors/booking";
import { refreshAccessToken } from "./google-oauth";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const FREEBUSY_URL = `${CALENDAR_BASE}/freeBusy`;
const ACCESS_TOKEN_SKEW_SECONDS = 300; // 5 min
const FREEBUSY_CACHE_TTL_MS = 60 * 1000;
const FREEBUSY_CACHE_MAX = 100;

// ----------------------------------------------------------------------------
// Internal: per-consultant access token cache
// ----------------------------------------------------------------------------

interface CachedAccessToken {
  accessToken: string;
  expiresAt: number; // unix seconds
}

const accessTokenCache = new Map<string, CachedAccessToken>();

// Exposed for tests + the admin "force reconnect" path.
export function clearAccessTokenCache(consultantId?: string): void {
  if (consultantId) accessTokenCache.delete(consultantId);
  else accessTokenCache.clear();
}

// ----------------------------------------------------------------------------
// getAccessToken — read+decrypt the refresh token, refresh, cache, return
// ----------------------------------------------------------------------------

async function loadConsultantRow(consultantId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: consultant.id,
      googleRefreshTokenEncrypted: consultant.googleRefreshTokenEncrypted,
      googleStatus: consultant.googleStatus,
    })
    .from(consultant)
    .where(eq(consultant.id, consultantId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new BookingError(`consultant ${consultantId} not found`);
  }
  if (!row.googleRefreshTokenEncrypted) {
    throw new GoogleAuthError(
      `consultant ${consultantId} has no Google grant — admin must connect via /admin/connect-google`,
    );
  }
  if (row.googleStatus === "stale") {
    throw new GoogleAuthErrorRevoked(
      `consultant ${consultantId} Google grant is marked stale — admin must re-grant via /admin/connect-google`,
    );
  }
  return row;
}

async function markConsultantStale(consultantId: string): Promise<void> {
  const db = getDb();
  await db
    .update(consultant)
    .set({ googleStatus: "stale", updatedAt: new Date() })
    .where(eq(consultant.id, consultantId));
  clearAccessTokenCache(consultantId);
}

export async function getAccessToken(consultantId: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);

  // Cache check with 5-min skew so we don't hand out a token that's
  // about to expire mid-API-call.
  const cached = accessTokenCache.get(consultantId);
  if (cached && cached.expiresAt - ACCESS_TOKEN_SKEW_SECONDS > nowSec) {
    return cached.accessToken;
  }

  // Cache miss or expiring — refresh.
  const row = await loadConsultantRow(consultantId);
  const refreshToken = decrypt(row.googleRefreshTokenEncrypted!);
  try {
    const refreshed = await refreshAccessToken(refreshToken);
    accessTokenCache.set(consultantId, {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  } catch (err) {
    if (err instanceof GoogleAuthErrorRevoked) {
      await markConsultantStale(consultantId);
    }
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Internal: API request helper with 401-retry + typed errors
// ----------------------------------------------------------------------------
//
// Calls a Google Calendar endpoint with the cached access token. On 401
// from Google (cached token was actually revoked despite not being
// expired), refreshes once and retries. On second 401, throws
// GoogleAuthErrorRevoked + marks consultant stale. Other status codes
// map to the named errors in lib/errors/booking.ts so route handlers
// can narrow.

interface CalendarRequestOpts {
  consultantId: string;
  method: "GET" | "POST" | "DELETE";
  url: string;
  body?: unknown;
}

async function calendarRequest<T>(
  opts: CalendarRequestOpts,
  attempt = 1,
): Promise<T | null> {
  const token = await getAccessToken(opts.consultantId);
  const init: RequestInit = {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const response = await fetch(opts.url, init);

  if (response.status === 401) {
    if (attempt > 1) {
      // Refresh + retry didn't fix it — the grant is really gone.
      await markConsultantStale(opts.consultantId);
      throw new GoogleAuthErrorRevoked(
        `Google Calendar returned 401 after refresh; grant revoked for consultant ${opts.consultantId}`,
      );
    }
    clearAccessTokenCache(opts.consultantId);
    return calendarRequest<T>(opts, attempt + 1);
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after") ?? "unknown";
    throw new GoogleRateLimitError(
      `Google Calendar rate-limited (retry-after: ${retryAfter})`,
    );
  }

  if (response.status >= 500) {
    throw new GoogleServerError(
      `Google Calendar ${response.status} ${response.statusText}`,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new BookingError(
      `Google Calendar ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
    );
  }

  // DELETE returns 204 No Content — no body to parse.
  if (response.status === 204) return null;

  return (await response.json()) as T;
}

// ----------------------------------------------------------------------------
// freeBusy.query — read busy intervals for a consultant's calendar
// ----------------------------------------------------------------------------
//
// Result is cached for 60s. Callers in lib/scheduler.ts invalidate the
// cache when a booking lands so the next slot lookup sees the new
// conflict immediately.

export interface BusyInterval {
  startUtc: string; // ISO 8601, e.g. "2026-05-14T06:00:00Z"
  endUtc: string;
}

interface FreebusyResponse {
  calendars: Record<
    string,
    { busy: Array<{ start: string; end: string }>; errors?: unknown }
  >;
}

interface FreebusyCacheEntry {
  expiresAt: number; // unix ms
  intervals: BusyInterval[];
}

const freebusyCache = new Map<string, FreebusyCacheEntry>();

function freebusyCacheKey(
  consultantId: string,
  calendarId: string,
  start: string,
  end: string,
): string {
  return `${consultantId}:${calendarId}:${start}:${end}`;
}

// Trim cache to most-recent FREEBUSY_CACHE_MAX entries when we cross
// the bound. Map preserves insertion order so deleting the oldest is
// O(1) per delete.
function evictIfOversized(): void {
  while (freebusyCache.size > FREEBUSY_CACHE_MAX) {
    const oldest = freebusyCache.keys().next().value;
    if (!oldest) break;
    freebusyCache.delete(oldest);
  }
}

export interface GetFreebusyInput {
  consultantId: string;
  calendarId: string; // usually 'primary'
  startUtc: string;
  endUtc: string;
}

export async function getFreebusy(
  input: GetFreebusyInput,
): Promise<BusyInterval[]> {
  const key = freebusyCacheKey(
    input.consultantId,
    input.calendarId,
    input.startUtc,
    input.endUtc,
  );
  const now = Date.now();
  const cached = freebusyCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.intervals;
  }

  const result = await calendarRequest<FreebusyResponse>({
    consultantId: input.consultantId,
    method: "POST",
    url: FREEBUSY_URL,
    body: {
      timeMin: input.startUtc,
      timeMax: input.endUtc,
      items: [{ id: input.calendarId }],
    },
  });

  const intervals: BusyInterval[] = (
    result?.calendars?.[input.calendarId]?.busy ?? []
  ).map((b) => ({ startUtc: b.start, endUtc: b.end }));

  // Replay LRU semantics: delete-then-set moves to most-recent slot.
  freebusyCache.delete(key);
  freebusyCache.set(key, {
    intervals,
    expiresAt: now + FREEBUSY_CACHE_TTL_MS,
  });
  evictIfOversized();

  return intervals;
}

// Invalidate every cached freebusy entry for this consultant. Cheap —
// max 100 entries in the cache, scanned once. Called by lib/scheduler.ts
// after events.insert / events.delete so subsequent availability queries
// see the conflict immediately.
//
// We bust all entries for the consultant rather than only overlapping
// ones. Window-precise invalidation would require parsing ISO date keys
// (colons-in-keys make a clean split awkward), and the cost of an
// occasional extra freebusy API call is trivial compared to the
// complexity of getting the math right.
export function invalidateFreebusyCache(consultantId: string): void {
  const prefix = `${consultantId}:`;
  for (const key of freebusyCache.keys()) {
    if (key.startsWith(prefix)) freebusyCache.delete(key);
  }
}

// ----------------------------------------------------------------------------
// events.insert — create a calendar event + generate a Google Meet link
// ----------------------------------------------------------------------------
//
// The `conferenceDataVersion=1` query param + `conferenceData.createRequest`
// is the formula that gets Google to attach a Meet link to the event.
// `requestId` must be unique per attempted creation (we use the booking
// id) — that's also Google's idempotency key, so a retried call with the
// same requestId returns the existing event instead of creating duplicates.

export interface CreateEventInput {
  consultantId: string;
  calendarId: string; // 'primary'
  summary: string;
  description: string;
  startUtc: string; // ISO 8601
  endUtc: string;
  // Used as the conferenceData.createRequest.requestId — must be
  // unique per booking. Pass the booking_request.id for natural
  // idempotency.
  bookingId: string;
  // Optional: invite the prospect's email as an attendee. Defaults to
  // empty (prospect just gets the Meet link in the confirmation email).
  attendeeEmails?: string[];
  // IANA tz string for the event's `start.timeZone` field. Use the
  // consultant's tz so Google renders it correctly on Rob's calendar.
  timeZone: string;
}

export interface CreatedEvent {
  eventId: string;
  meetUrl: string | null;
  htmlLink: string | null;
}

interface CalendarEvent {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>;
  };
}

export async function createEvent(
  input: CreateEventInput,
): Promise<CreatedEvent> {
  const url = new URL(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events`,
  );
  url.searchParams.set("conferenceDataVersion", "1");
  // sendUpdates=all triggers Google's native attendee invite email —
  // .ics attachment, Yes/No/Maybe RSVP buttons, "Add to calendar" UI.
  // Sent from the consultant's calendar address (higher trust than
  // Resend). Complements our branded confirmation email which carries
  // the manage link + prep brief framing.
  url.searchParams.set("sendUpdates", "all");

  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startUtc, timeZone: input.timeZone },
    end: { dateTime: input.endUtc, timeZone: input.timeZone },
    attendees: (input.attendeeEmails ?? []).map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: input.bookingId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const event = await calendarRequest<CalendarEvent>({
    consultantId: input.consultantId,
    method: "POST",
    url: url.toString(),
    body,
  });

  if (!event) {
    throw new GoogleServerError(
      "Google Calendar events.insert returned no body",
    );
  }

  // The Meet link arrives via either `hangoutLink` (legacy field) or
  // `conferenceData.entryPoints[].uri` (modern). Check both.
  const meetEntry = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video",
  );
  const meetUrl = event.hangoutLink ?? meetEntry?.uri ?? null;

  invalidateFreebusyCache(input.consultantId);

  return {
    eventId: event.id,
    meetUrl,
    htmlLink: event.htmlLink ?? null,
  };
}

// ----------------------------------------------------------------------------
// events.delete — cancel a calendar event on booking cancel/reschedule
// ----------------------------------------------------------------------------
//
// Idempotent: Google returns 410 (Gone) if the event is already
// deleted; we treat that as success. Callers in lib/scheduler.ts use
// this on cancel + reschedule; cancel additionally sends notifications
// to the attendee via sendUpdates=all.

export interface DeleteEventInput {
  consultantId: string;
  calendarId: string;
  eventId: string;
  // If true, Google emails the cancellation to attendees too. Default
  // false — we handle cancel notifications via our own templated email
  // for voice consistency.
  notifyAttendees?: boolean;
}

export async function deleteEvent(input: DeleteEventInput): Promise<void> {
  const url = new URL(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
  );
  url.searchParams.set(
    "sendUpdates",
    input.notifyAttendees ? "all" : "none",
  );

  // calendarRequest throws on non-2xx. 410 (already deleted) isn't OK,
  // so we catch it and treat as success.
  try {
    await calendarRequest<null>({
      consultantId: input.consultantId,
      method: "DELETE",
      url: url.toString(),
    });
  } catch (err) {
    if (
      err instanceof BookingError &&
      err.message.includes("410")
    ) {
      // Already deleted — idempotent.
    } else {
      throw err;
    }
  }

  invalidateFreebusyCache(input.consultantId);
}
