import "server-only";

// Cron dispatch — per-job-kind handlers for the scheduled_job queue.
// Called from /api/cron/process-scheduled for each dequeued row.
//
// Each handler:
//   1. Loads the booking + consultant
//   2. Checks skip conditions (e.g. booking cancelled → skip; not
//      a no-show → skip noshow_recovery)
//   3. Renders the kind-specific email (some kinds call Claude first)
//   4. Sends via Resend
//   5. Stamps the appropriate *_sent_at column on booking_request
//
// Returns an outcome the route handler uses to call markSent /
// markSkipped / markFailed on the scheduled_job row. Pure dispatch
// — DB writes for job lifecycle live in lib/scheduler.ts.

import { eq } from "drizzle-orm";
import {
  buildBookingNoshowRecoveryEmail,
  buildBookingPostcallFollowupEmail,
  buildBookingPrecallBriefEmail,
  buildBookingReminder1hEmail,
  buildBookingReminder24hEmail,
  type RenderedEmail,
} from "./booking-emails";
import { generatePreCallBrief } from "./claude-booking";
import { getDb } from "./db";
import { bookingRequest, consultant } from "./db/schema";
import { generateJti, signMagicLink } from "./jwt-magic-link";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type JobOutcome =
  | { kind: "sent"; claudeCostUsd?: number }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string };

export interface DispatchInput {
  // Mirrors lib/scheduler.DequeuedJob so the route can pass it through.
  id: string;
  kind: string;
  bookingId: string;
  attempts: number;
  // Public origin needed to build manage URLs in reminder emails.
  origin: string;
  // Side-effect injectors so tests can mock the email transport. In
  // production these are wired to Resend + Claude in the route handler.
  sendEmail: (to: string, email: RenderedEmail) => Promise<void>;
}

// ----------------------------------------------------------------------------
// dispatch — single entry point used by the cron route
// ----------------------------------------------------------------------------

export async function dispatchJob(input: DispatchInput): Promise<JobOutcome> {
  const ctx = await loadJobContext(input.bookingId);
  if (!ctx) {
    return {
      kind: "skipped",
      reason: `Booking ${input.bookingId} not found`,
    };
  }

  // Universal skip: bookings that are no longer confirmed don't get
  // reminders, briefs, or follow-ups. noshow_recovery has its own
  // status check (only sends if status='no_show').
  if (
    input.kind !== "noshow_recovery" &&
    ctx.booking.status !== "confirmed"
  ) {
    return {
      kind: "skipped",
      reason: `Booking status '${ctx.booking.status}' — no email`,
    };
  }

  switch (input.kind) {
    case "reminder_24h":
      return dispatchReminder24h(input, ctx);
    case "reminder_1h":
      return dispatchReminder1h(input, ctx);
    case "precall_brief":
      return dispatchPrecallBrief(input, ctx);
    case "postcall_followup":
      return dispatchPostcallFollowup(input, ctx);
    case "noshow_recovery":
      return dispatchNoshowRecovery(input, ctx);
    case "confirmation":
      // We send confirmations synchronously at booking-create time and
      // enqueue with excludeKinds=['confirmation'], so this branch
      // shouldn't fire. If it does (e.g. a row from an older flow),
      // skip rather than double-send.
      return {
        kind: "skipped",
        reason: "Confirmation is sent synchronously at booking creation",
      };
    default:
      return { kind: "failed", error: `Unknown job kind '${input.kind}'` };
  }
}

// ----------------------------------------------------------------------------
// Job context — booking + consultant loaded together
// ----------------------------------------------------------------------------

interface JobContext {
  booking: {
    id: string;
    name: string;
    email: string;
    organisation: string | null;
    position: string | null;
    reasonInitial: string;
    reasonFollowups: { question: string; answer: string }[];
    slotStart: Date;
    slotEnd: Date;
    prospectTimezone: string;
    status: string;
    meetUrl: string | null;
    cancelJti: string | null;
    precallBriefSentAt: Date | null;
    reminder24hSentAt: Date | null;
    reminder1hSentAt: Date | null;
    postcallFollowupSentAt: Date | null;
    noshowRecoverySentAt: Date | null;
  };
  consultant: {
    id: string;
    slug: string;
    displayName: string;
    email: string;
    timezone: string;
    slotMinutes: number;
  };
}

async function loadJobContext(bookingId: string): Promise<JobContext | null> {
  const rows = await getDb()
    .select({
      bid: bookingRequest.id,
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
      meetUrl: bookingRequest.meetUrl,
      cancelJti: bookingRequest.cancelJti,
      precallBriefSentAt: bookingRequest.precallBriefSentAt,
      reminder24hSentAt: bookingRequest.reminder24hSentAt,
      reminder1hSentAt: bookingRequest.reminder1hSentAt,
      postcallFollowupSentAt: bookingRequest.postcallFollowupSentAt,
      noshowRecoverySentAt: bookingRequest.noshowRecoverySentAt,
      cid: consultant.id,
      cslug: consultant.slug,
      cdisplayName: consultant.displayName,
      cemail: consultant.email,
      ctimezone: consultant.timezone,
      cslotMinutes: consultant.slotMinutes,
    })
    .from(bookingRequest)
    .innerJoin(consultant, eq(consultant.id, bookingRequest.consultantId))
    .where(eq(bookingRequest.id, bookingId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    booking: {
      id: row.bid,
      name: row.name,
      email: row.email,
      organisation: row.organisation,
      position: row.position,
      reasonInitial: row.reasonInitial,
      reasonFollowups:
        (row.reasonFollowups as { question: string; answer: string }[]) ?? [],
      slotStart: row.slotStart,
      slotEnd: row.slotEnd,
      prospectTimezone: row.prospectTimezone,
      status: row.status,
      meetUrl: row.meetUrl,
      cancelJti: row.cancelJti,
      precallBriefSentAt: row.precallBriefSentAt,
      reminder24hSentAt: row.reminder24hSentAt,
      reminder1hSentAt: row.reminder1hSentAt,
      postcallFollowupSentAt: row.postcallFollowupSentAt,
      noshowRecoverySentAt: row.noshowRecoverySentAt,
    },
    consultant: {
      id: row.cid,
      slug: row.cslug,
      displayName: row.cdisplayName,
      email: row.cemail,
      timezone: row.ctimezone,
      slotMinutes: row.cslotMinutes,
    },
  };
}

// ----------------------------------------------------------------------------
// Per-kind dispatchers
// ----------------------------------------------------------------------------

async function dispatchReminder24h(
  input: DispatchInput,
  ctx: JobContext,
): Promise<JobOutcome> {
  if (ctx.booking.reminder24hSentAt) {
    return { kind: "skipped", reason: "Already sent" };
  }
  const manageUrl = await buildManageUrl(ctx, input.origin);
  const email = buildBookingReminder24hEmail({
    prospectFirstName: firstNameFrom(ctx.booking.name),
    slotTimeLocal: formatTimeOnly(ctx.booking.slotStart, ctx.booking.prospectTimezone),
    meetUrl: ctx.booking.meetUrl ?? "(Meet link in your calendar invite)",
    manageUrl,
  });
  try {
    await input.sendEmail(ctx.booking.email, email);
    await getDb()
      .update(bookingRequest)
      .set({ reminder24hSentAt: new Date(), updatedAt: new Date() })
      .where(eq(bookingRequest.id, ctx.booking.id));
    return { kind: "sent" };
  } catch (err) {
    return { kind: "failed", error: errorMessage(err) };
  }
}

async function dispatchReminder1h(
  input: DispatchInput,
  ctx: JobContext,
): Promise<JobOutcome> {
  if (ctx.booking.reminder1hSentAt) {
    return { kind: "skipped", reason: "Already sent" };
  }
  const email = buildBookingReminder1hEmail({
    prospectFirstName: firstNameFrom(ctx.booking.name),
    meetUrl: ctx.booking.meetUrl ?? "(Meet link in your calendar invite)",
  });
  try {
    await input.sendEmail(ctx.booking.email, email);
    await getDb()
      .update(bookingRequest)
      .set({ reminder1hSentAt: new Date(), updatedAt: new Date() })
      .where(eq(bookingRequest.id, ctx.booking.id));
    return { kind: "sent" };
  } catch (err) {
    return { kind: "failed", error: errorMessage(err) };
  }
}

async function dispatchPrecallBrief(
  input: DispatchInput,
  ctx: JobContext,
): Promise<JobOutcome> {
  if (ctx.booking.precallBriefSentAt) {
    return { kind: "skipped", reason: "Already sent" };
  }

  // Claude call — may return a null brief on transient failure. We
  // gracefully degrade by sending a "raw intake" brief so Rob still
  // walks in informed.
  let briefResult;
  try {
    briefResult = await generatePreCallBrief({
      prospectName: ctx.booking.name,
      prospectRole: ctx.booking.position ?? "(role not given)",
      prospectOrganisation:
        ctx.booking.organisation ?? "(organisation not given)",
      reasonInitial: ctx.booking.reasonInitial,
      followups: ctx.booking.reasonFollowups,
    });
  } catch (err) {
    // Claude refusal / parse error → fall back to raw-intake brief.
    briefResult = { brief: null, costUsd: null };
    console.warn("[cron-dispatch] precall_brief Claude failed:", err);
  }

  const slotTimeLocal = formatTimeOnly(
    ctx.booking.slotStart,
    ctx.consultant.timezone,
  );

  // If Claude returned nothing, build a degraded brief from the raw
  // intake so Rob still has the prospect's exact words.
  const brief = briefResult.brief ?? {
    summary: `(Brief unavailable — raw intake below.) ${ctx.booking.reasonInitial.slice(0, 300)}`,
    priorityScore: "P2" as const,
    priorityReason: "Auto-fallback — Claude unavailable",
    talkingPoints: [
      "Confirm what they actually want from the 30 min",
      "Probe urgency + decision authority",
      "Surface the concrete problem behind the framing",
    ],
  };

  const email = buildBookingPrecallBriefEmail({
    prospectName: ctx.booking.name,
    prospectRole: ctx.booking.position ?? "(role not given)",
    prospectOrganisation:
      ctx.booking.organisation ?? "(organisation not given)",
    slotTimeLocal,
    priorityScore: brief.priorityScore,
    priorityReason: brief.priorityReason,
    summaryParagraph: brief.summary,
    talkingPoints: brief.talkingPoints,
    intakeTranscript: ctx.booking.reasonFollowups,
  });

  try {
    // Pre-call brief goes to the CONSULTANT (Rob), not the prospect.
    await input.sendEmail(ctx.consultant.email, email);
    await getDb()
      .update(bookingRequest)
      .set({ precallBriefSentAt: new Date(), updatedAt: new Date() })
      .where(eq(bookingRequest.id, ctx.booking.id));
    return { kind: "sent", claudeCostUsd: briefResult.costUsd ?? undefined };
  } catch (err) {
    return { kind: "failed", error: errorMessage(err) };
  }
}

async function dispatchPostcallFollowup(
  input: DispatchInput,
  ctx: JobContext,
): Promise<JobOutcome> {
  if (ctx.booking.postcallFollowupSentAt) {
    return { kind: "skipped", reason: "Already sent" };
  }
  const email = buildBookingPostcallFollowupEmail({
    prospectFirstName: firstNameFrom(ctx.booking.name),
    intakeTopic: extractTopic(ctx.booking.reasonInitial),
    // v1: placeholder bullets. Admin-curated bullets land when there's
    // a per-booking "Rob edits before send" UI.
    nextStepsBullets: [
      "Recap notes follow under separate cover.",
      "If anything's unclear, hit reply and we'll keep talking.",
    ],
    rebookUrl: `${input.origin}/book/${ctx.consultant.slug}`,
  });
  try {
    await input.sendEmail(ctx.booking.email, email);
    await getDb()
      .update(bookingRequest)
      .set({ postcallFollowupSentAt: new Date(), updatedAt: new Date() })
      .where(eq(bookingRequest.id, ctx.booking.id));
    return { kind: "sent" };
  } catch (err) {
    return { kind: "failed", error: errorMessage(err) };
  }
}

async function dispatchNoshowRecovery(
  input: DispatchInput,
  ctx: JobContext,
): Promise<JobOutcome> {
  // Only fire if explicitly marked as no_show. confirmed / completed /
  // cancelled all skip.
  if (ctx.booking.status !== "no_show") {
    return {
      kind: "skipped",
      reason: `Booking status '${ctx.booking.status}' (not no_show)`,
    };
  }
  if (ctx.booking.noshowRecoverySentAt) {
    return { kind: "skipped", reason: "Already sent" };
  }
  const email = buildBookingNoshowRecoveryEmail({
    prospectFirstName: firstNameFrom(ctx.booking.name),
    rebookUrl: `${input.origin}/book/${ctx.consultant.slug}`,
  });
  try {
    await input.sendEmail(ctx.booking.email, email);
    await getDb()
      .update(bookingRequest)
      .set({ noshowRecoverySentAt: new Date(), updatedAt: new Date() })
      .where(eq(bookingRequest.id, ctx.booking.id));
    return { kind: "sent" };
  } catch (err) {
    return { kind: "failed", error: errorMessage(err) };
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// The manage URL embeds a fresh-or-existing cancel token. If the
// booking still has a cancelJti, sign it; otherwise mint a fresh one
// (and persist it). This way the magic-link link in the reminder
// email is always usable.
async function buildManageUrl(
  ctx: JobContext,
  origin: string,
): Promise<string> {
  let jti = ctx.booking.cancelJti;
  if (!jti) {
    jti = generateJti();
    await getDb()
      .update(bookingRequest)
      .set({ cancelJti: jti, updatedAt: new Date() })
      .where(eq(bookingRequest.id, ctx.booking.id));
  }
  const token = await signMagicLink(ctx.booking.id, "cancel", jti);
  return `${origin}/book/manage/${encodeURIComponent(token)}`;
}

function firstNameFrom(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "there";
}

function formatTimeOnly(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

// Pull the first ~120 chars of the reason as the "topic" line for the
// post-call email opener. Trims at sentence-end if it can.
function extractTopic(reason: string): string {
  const trimmed = reason.trim().slice(0, 200);
  const firstSentence = trimmed.match(/^[^.!?]+[.!?]?/);
  return (firstSentence?.[0] ?? trimmed).slice(0, 120);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
