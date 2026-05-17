import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { scheduledJob } from "./db/schema";

// Queue dispatcher for the Book-a-Call email pipeline.
//
// Each confirmed booking enqueues 6 jobs:
//   - confirmation       — fires immediately
//   - precall_brief      — slot_start - 2h  (Claude-generated agenda)
//   - reminder_24h       — slot_start - 24h
//   - reminder_1h        — slot_start - 1h  (final reminder + Meet link)
//   - postcall_followup  — slot_end + 30min
//   - noshow_recovery    — slot_end + 30min (cron skips if status != no_show)
//
// The cron handler at /api/cron/process-scheduled (lands in a later PR)
// calls dequeueBatch() with a workerId, processes each row, and stamps
// markSent / markFailed / markSkipped. FOR UPDATE SKIP LOCKED gives us
// overlapping-cron-safety without a separate lock table.
//
// All DB writes go through this module — route handlers and the cron
// processor never touch the scheduled_job table directly. That keeps
// the state machine (pending → processing → sent | failed | skipped)
// in one place.

export const MAX_ATTEMPTS = 3;
const LOCK_TTL_MS = 5 * 60_000;

// Timing offsets (ms) for each job kind relative to slot_start (negative
// values fire before the call) or slot_end (positive values fire after).
// Confirmation has no offset — it fires when the booking lands. Exported
// so tests + admin tooling can read the same constants.
export const JOB_TIMING = {
  confirmation: { anchor: "now" as const, offsetMs: 0 },
  precall_brief: { anchor: "slotStart" as const, offsetMs: -2 * 60 * 60_000 },
  reminder_24h: { anchor: "slotStart" as const, offsetMs: -24 * 60 * 60_000 },
  reminder_1h: { anchor: "slotStart" as const, offsetMs: -1 * 60 * 60_000 },
  postcall_followup: { anchor: "slotEnd" as const, offsetMs: 30 * 60_000 },
  noshow_recovery: { anchor: "slotEnd" as const, offsetMs: 30 * 60_000 },
} as const;

export type JobKind = keyof typeof JOB_TIMING;
export const JOB_KINDS = Object.keys(JOB_TIMING) as JobKind[];

export type JobStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "skipped";

// ----------------------------------------------------------------------------
// Pure helpers — fully unit-testable without a DB
// ----------------------------------------------------------------------------

export interface PlannedJob {
  kind: JobKind;
  dueAt: Date;
  initialStatus: "pending" | "skipped";
}

// Compute when each job for a booking fires + whether it's skipped at
// enqueue time. A reminder whose due time is already in the past at
// booking-creation gets marked 'skipped' so the cron doesn't fire a
// stale "your call is tomorrow" the moment a booking lands 30 min out.
// Confirmation never gets skipped — it always fires.
export function planBookingJobs(input: {
  slotStart: Date;
  slotEnd: Date;
  now: Date;
}): PlannedJob[] {
  const { slotStart, slotEnd, now } = input;
  return JOB_KINDS.map((kind) => {
    const def = JOB_TIMING[kind];
    let dueAt: Date;
    if (def.anchor === "now") {
      dueAt = new Date(now.getTime() + def.offsetMs);
    } else if (def.anchor === "slotStart") {
      dueAt = new Date(slotStart.getTime() + def.offsetMs);
    } else {
      dueAt = new Date(slotEnd.getTime() + def.offsetMs);
    }
    const past = dueAt.getTime() < now.getTime();
    const initialStatus: "pending" | "skipped" =
      kind === "confirmation" || !past ? "pending" : "skipped";
    return { kind, dueAt, initialStatus };
  });
}

// Map an attempt count to the post-failure status. attempts is the value
// AFTER the failed attempt is recorded (i.e. attempts >= MAX_ATTEMPTS
// means the just-failed attempt was the last one allowed).
export function decideRetryStatus(
  attempts: number,
  maxAttempts: number = MAX_ATTEMPTS,
): "pending" | "failed" {
  return attempts >= maxAttempts ? "failed" : "pending";
}

// ----------------------------------------------------------------------------
// DB wrappers
// ----------------------------------------------------------------------------

export interface DequeuedJob {
  id: string;
  kind: string;
  bookingId: string;
  dueAt: Date;
  attempts: number;
}

// Insert all jobs for a new booking. Idempotency is the caller's
// responsibility — booking_request.idempotency_key keeps duplicate
// bookings out, so scheduled rows are only created once per booking.
//
// `excludeKinds` lets the caller skip enqueueing specific kinds — used
// by the booking-create route which sends the confirmation email
// synchronously, so the queued confirmation would just be a duplicate
// fire once cron lands.
export async function enqueueBookingJobs(input: {
  bookingId: string;
  slotStart: Date;
  slotEnd: Date;
  now: Date;
  excludeKinds?: JobKind[];
}): Promise<void> {
  const planned = planBookingJobs(input);
  const skip = new Set(input.excludeKinds ?? []);
  const rows = planned
    .filter((p) => !skip.has(p.kind))
    .map((p) => ({
      bookingId: input.bookingId,
      kind: p.kind,
      dueAt: p.dueAt,
      status: p.initialStatus,
    }));
  if (rows.length === 0) return;
  await getDb().insert(scheduledJob).values(rows);
}

// Pull up to `limit` due jobs and lock them for this worker.
//
// FOR UPDATE SKIP LOCKED semantics: rows already locked by an
// overlapping cron run are silently skipped instead of blocking.
// The row-level lock auto-releases on tx commit; locked_by +
// locked_until give observability and a fallback for stale-lock
// recovery if a worker crashes mid-batch.
//
// Returned rows have already had attempts++ and status='processing'
// applied. The caller processes each, then calls markSent / markFailed
// / markSkipped to settle.
export async function dequeueBatch(input: {
  workerId: string;
  limit: number;
  now: Date;
}): Promise<DequeuedJob[]> {
  const { workerId, limit, now } = input;
  const db = getDb();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: scheduledJob.id,
        kind: scheduledJob.kind,
        bookingId: scheduledJob.bookingId,
        dueAt: scheduledJob.dueAt,
        attempts: scheduledJob.attempts,
      })
      .from(scheduledJob)
      .where(
        and(
          eq(scheduledJob.status, "pending"),
          lte(scheduledJob.dueAt, now),
        ),
      )
      .orderBy(asc(scheduledJob.dueAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const lockedUntil = new Date(now.getTime() + LOCK_TTL_MS);

    await tx
      .update(scheduledJob)
      .set({
        status: "processing",
        lockedBy: workerId,
        lockedUntil,
        attempts: sql`${scheduledJob.attempts} + 1`,
        lastAttemptedAt: now,
        updatedAt: now,
      })
      .where(inArray(scheduledJob.id, ids));

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      bookingId: r.bookingId,
      dueAt: r.dueAt,
      // The DB row now reflects attempts+1; return the post-increment
      // value so callers don't have to re-read.
      attempts: r.attempts + 1,
    }));
  });
}

// Settle a processed job successfully. `claudeCostUsd` is optional —
// Claude-touching kinds (precall_brief, noshow_recovery) pass it; pure
// template emails leave it unset. The booking_request.claude_cost_usd_total
// roll-up happens in the cron handler (a separate UPDATE) once all jobs
// in the batch are settled.
export async function markSent(input: {
  jobId: string;
  claudeCostUsd?: number;
  now: Date;
}): Promise<void> {
  await getDb()
    .update(scheduledJob)
    .set({
      status: "sent",
      lockedBy: null,
      lockedUntil: null,
      lastError: null,
      claudeCostUsd: input.claudeCostUsd?.toString(),
      updatedAt: input.now,
    })
    .where(eq(scheduledJob.id, input.jobId));
}

// Settle a failed processed job. If attempts has hit MAX_ATTEMPTS, status
// goes to 'failed' (terminal — the cron handler emits an alert). Else it
// flips back to 'pending' so the next cron run picks it up.
export async function markFailed(input: {
  jobId: string;
  attempts: number;
  error: string;
  now: Date;
}): Promise<void> {
  const next = decideRetryStatus(input.attempts);
  await getDb()
    .update(scheduledJob)
    .set({
      status: next,
      lockedBy: null,
      lockedUntil: null,
      // Trim defensively so a giant stack trace can't break the column.
      // The cron alert quotes this string verbatim so a sensible cap matters.
      lastError: input.error.slice(0, 500),
      updatedAt: input.now,
    })
    .where(eq(scheduledJob.id, input.jobId));
}

// Settle a job that became irrelevant — e.g. the cron picked up a
// reminder_1h whose booking was cancelled while it was in flight. Skipped
// is terminal: never retried.
export async function markSkipped(input: {
  jobId: string;
  reason: string;
  now: Date;
}): Promise<void> {
  await getDb()
    .update(scheduledJob)
    .set({
      status: "skipped",
      lockedBy: null,
      lockedUntil: null,
      lastError: input.reason.slice(0, 500),
      updatedAt: input.now,
    })
    .where(eq(scheduledJob.id, input.jobId));
}

// Cancel pending jobs for a booking. Used by the cancel + reschedule
// flows. Only 'pending' rows flip — already-sent rows stay sent (they
// happened), already-processing rows get skipped on completion by the
// cron handler reading booking status. The new booking from a reschedule
// gets its own fresh set of jobs via enqueueBookingJobs.
export async function cancelJobsForBooking(input: {
  bookingId: string;
  reason: string;
  now: Date;
}): Promise<number> {
  const result = await getDb()
    .update(scheduledJob)
    .set({
      status: "skipped",
      lastError: input.reason.slice(0, 500),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(scheduledJob.bookingId, input.bookingId),
        eq(scheduledJob.status, "pending"),
      ),
    )
    .returning({ id: scheduledJob.id });
  return result.length;
}

// Recover rows stuck in 'processing' whose lock has expired. Used by the
// cron handler at the top of each run before dequeueing. Worker
// processes are expected to settle their own rows; this only matters
// if a process crashed mid-batch (OOM kill, Render redeploy mid-flight,
// etc.).
export async function recoverStaleLocks(input: { now: Date }): Promise<number> {
  const result = await getDb()
    .update(scheduledJob)
    .set({
      status: "pending",
      lockedBy: null,
      lockedUntil: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(scheduledJob.status, "processing"),
        lte(scheduledJob.lockedUntil, input.now),
      ),
    )
    .returning({ id: scheduledJob.id });
  return result.length;
}
