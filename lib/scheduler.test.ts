import { describe, expect, it } from "vitest";
import {
  decideRetryStatus,
  JOB_KINDS,
  JOB_TIMING,
  MAX_ATTEMPTS,
  planBookingJobs,
} from "./scheduler";

// Pure-function tests. The DB wrappers (enqueueBookingJobs, dequeueBatch,
// markSent / markFailed / markSkipped, cancelJobsForBooking,
// recoverStaleLocks) are covered by integration tests that hit a real
// Postgres — those land alongside the cron handler PR so the round-trip
// is verified end-to-end.

describe("planBookingJobs", () => {
  it("plans all six job kinds", () => {
    const plans = planBookingJobs({
      slotStart: new Date("2026-05-20T01:00:00Z"),
      slotEnd: new Date("2026-05-20T01:30:00Z"),
      now: new Date("2026-05-13T00:00:00Z"),
    });
    expect(plans).toHaveLength(6);
    expect(plans.map((p) => p.kind).sort()).toEqual([...JOB_KINDS].sort());
  });

  it("computes confirmation dueAt = now", () => {
    const now = new Date("2026-05-13T00:00:00Z");
    const plan = planBookingJobs({
      slotStart: new Date("2026-05-20T01:00:00Z"),
      slotEnd: new Date("2026-05-20T01:30:00Z"),
      now,
    });
    const confirm = plan.find((p) => p.kind === "confirmation");
    expect(confirm?.dueAt.toISOString()).toBe(now.toISOString());
    expect(confirm?.initialStatus).toBe("pending");
  });

  it("computes precall_brief at slot_start - 2h", () => {
    const slotStart = new Date("2026-05-20T01:00:00Z");
    const plan = planBookingJobs({
      slotStart,
      slotEnd: new Date("2026-05-20T01:30:00Z"),
      now: new Date("2026-05-13T00:00:00Z"),
    });
    const brief = plan.find((p) => p.kind === "precall_brief");
    expect(brief?.dueAt.toISOString()).toBe("2026-05-19T23:00:00.000Z");
  });

  it("computes reminder_24h at slot_start - 24h", () => {
    const slotStart = new Date("2026-05-20T01:00:00Z");
    const plan = planBookingJobs({
      slotStart,
      slotEnd: new Date("2026-05-20T01:30:00Z"),
      now: new Date("2026-05-13T00:00:00Z"),
    });
    const r24 = plan.find((p) => p.kind === "reminder_24h");
    expect(r24?.dueAt.toISOString()).toBe("2026-05-19T01:00:00.000Z");
  });

  it("computes reminder_1h at slot_start - 1h", () => {
    const slotStart = new Date("2026-05-20T01:00:00Z");
    const plan = planBookingJobs({
      slotStart,
      slotEnd: new Date("2026-05-20T01:30:00Z"),
      now: new Date("2026-05-13T00:00:00Z"),
    });
    const r1 = plan.find((p) => p.kind === "reminder_1h");
    expect(r1?.dueAt.toISOString()).toBe("2026-05-20T00:00:00.000Z");
  });

  it("computes postcall_followup at slot_end + 30min", () => {
    const slotEnd = new Date("2026-05-20T01:30:00Z");
    const plan = planBookingJobs({
      slotStart: new Date("2026-05-20T01:00:00Z"),
      slotEnd,
      now: new Date("2026-05-13T00:00:00Z"),
    });
    const followup = plan.find((p) => p.kind === "postcall_followup");
    expect(followup?.dueAt.toISOString()).toBe("2026-05-20T02:00:00.000Z");
  });

  it("computes noshow_recovery at slot_end + 30min", () => {
    const slotEnd = new Date("2026-05-20T01:30:00Z");
    const plan = planBookingJobs({
      slotStart: new Date("2026-05-20T01:00:00Z"),
      slotEnd,
      now: new Date("2026-05-13T00:00:00Z"),
    });
    const noshow = plan.find((p) => p.kind === "noshow_recovery");
    expect(noshow?.dueAt.toISOString()).toBe("2026-05-20T02:00:00.000Z");
  });

  it("marks past-due reminders as skipped at enqueue (last-minute booking)", () => {
    // Booking lands 30min before slot_start: reminder_24h and reminder_1h
    // both have past dueAt times. precall_brief (-2h) is also past.
    // confirmation fires regardless. postcall_followup / noshow_recovery
    // are in the future.
    const now = new Date("2026-05-20T00:30:00Z");
    const plan = planBookingJobs({
      slotStart: new Date("2026-05-20T01:00:00Z"),
      slotEnd: new Date("2026-05-20T01:30:00Z"),
      now,
    });
    const byKind = new Map(plan.map((p) => [p.kind, p]));

    expect(byKind.get("confirmation")?.initialStatus).toBe("pending");
    expect(byKind.get("precall_brief")?.initialStatus).toBe("skipped");
    expect(byKind.get("reminder_24h")?.initialStatus).toBe("skipped");
    expect(byKind.get("reminder_1h")?.initialStatus).toBe("skipped");
    expect(byKind.get("postcall_followup")?.initialStatus).toBe("pending");
    expect(byKind.get("noshow_recovery")?.initialStatus).toBe("pending");
  });

  it("keeps all reminders pending when booking is far in advance", () => {
    const plan = planBookingJobs({
      slotStart: new Date("2026-06-01T01:00:00Z"),
      slotEnd: new Date("2026-06-01T01:30:00Z"),
      now: new Date("2026-05-13T00:00:00Z"),
    });
    for (const p of plan) {
      expect(p.initialStatus).toBe("pending");
    }
  });

  it("confirmation is never skipped even if the slot is in the past", () => {
    // Defensive: even if a caller somehow passes a past slot_start, the
    // confirmation email still goes out (the slot itself is the caller's
    // problem to validate — see the booking-window check in /api/booking/create).
    const plan = planBookingJobs({
      slotStart: new Date("2026-05-01T00:00:00Z"),
      slotEnd: new Date("2026-05-01T00:30:00Z"),
      now: new Date("2026-05-13T00:00:00Z"),
    });
    const confirm = plan.find((p) => p.kind === "confirmation");
    expect(confirm?.initialStatus).toBe("pending");
  });
});

describe("decideRetryStatus", () => {
  it("retries while under max attempts", () => {
    expect(decideRetryStatus(1)).toBe("pending");
    expect(decideRetryStatus(MAX_ATTEMPTS - 1)).toBe("pending");
  });

  it("terminates at max attempts", () => {
    expect(decideRetryStatus(MAX_ATTEMPTS)).toBe("failed");
    expect(decideRetryStatus(MAX_ATTEMPTS + 5)).toBe("failed");
  });

  it("respects a custom max", () => {
    expect(decideRetryStatus(2, 5)).toBe("pending");
    expect(decideRetryStatus(5, 5)).toBe("failed");
  });
});

describe("JOB_TIMING constants", () => {
  it("covers every job kind", () => {
    expect(Object.keys(JOB_TIMING).sort()).toEqual(
      [
        "confirmation",
        "noshow_recovery",
        "postcall_followup",
        "precall_brief",
        "reminder_1h",
        "reminder_24h",
      ].sort(),
    );
  });

  it("uses negative offsets for pre-call jobs and positive for post-call", () => {
    expect(JOB_TIMING.precall_brief.offsetMs).toBeLessThan(0);
    expect(JOB_TIMING.reminder_24h.offsetMs).toBeLessThan(0);
    expect(JOB_TIMING.reminder_1h.offsetMs).toBeLessThan(0);
    expect(JOB_TIMING.postcall_followup.offsetMs).toBeGreaterThan(0);
    expect(JOB_TIMING.noshow_recovery.offsetMs).toBeGreaterThan(0);
    expect(JOB_TIMING.confirmation.offsetMs).toBe(0);
  });
});
