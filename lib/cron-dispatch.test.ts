import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// cron-dispatch routes incoming scheduled-job rows to per-kind handlers
// that load the booking + consultant from the DB, render emails, and
// send via Resend. Pure unit tests would require heavy DB + Resend
// mocking; instead we test the dispatch routing + skip-condition logic
// against a stubbed getDb. The route-level happy path is covered by
// manual smoke testing after deploy.

// Mutable mock booking context returned by getDb queries. Tests poke
// at this to set up status/sent-at scenarios.
let mockBooking: {
  status: string;
  precallBriefSentAt: Date | null;
  reminder24hSentAt: Date | null;
  reminder1hSentAt: Date | null;
  postcallFollowupSentAt: Date | null;
  noshowRecoverySentAt: Date | null;
  cancelJti: string | null;
} = {
  status: "confirmed",
  precallBriefSentAt: null,
  reminder24hSentAt: null,
  reminder1hSentAt: null,
  postcallFollowupSentAt: null,
  noshowRecoverySentAt: null,
  cancelJti: "test-jti",
};

// Simple chainable Drizzle stub. select().from().innerJoin?().where().limit()
// resolves to a single-row array shaped like the column aliases in
// loadJobContext.
const baseRow = {
  bid: "booking-id",
  name: "Sample Prospect",
  email: "prospect@example.com",
  organisation: "Acme Inc",
  position: "CTO",
  reasonInitial:
    "We are stuck on a data migration that has been running for 6 months.",
  reasonFollowups: [],
  slotStart: new Date("2026-06-01T01:00:00Z"),
  slotEnd: new Date("2026-06-01T01:30:00Z"),
  prospectTimezone: "Australia/Sydney",
  meetUrl: "https://meet.google.com/abc-defg-hij",
  cid: "consultant-id",
  cslug: "archos-labs",
  cdisplayName: "Rob Angeles",
  cemail: "rob.angeles@archoslabs.xyz",
  ctimezone: "Australia/Sydney",
  cslotMinutes: 30,
};

function makeRow() {
  return { ...baseRow, ...mockBooking };
}

const updateCalls: Array<{ id: string; sets: Record<string, unknown> }> = [];

vi.mock("./db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => [makeRow()] }),
        }),
        where: () => ({ limit: async () => [makeRow()] }),
      }),
    }),
    update: () => ({
      set: (sets: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push({ id: "stub", sets });
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

// Claude pre-call brief — stub returns a happy-path brief so the
// precall test exercises the render + send path, not the Claude call.
vi.mock("./claude-booking", () => ({
  generatePreCallBrief: async () => ({
    brief: {
      summary: "Mock summary",
      priorityScore: "P1" as const,
      priorityReason: "Mock reason",
      talkingPoints: ["Point 1", "Point 2", "Point 3"],
    },
    costUsd: 0.001,
  }),
}));

// Magic-link signing — stub deterministically so manage URLs are
// reproducible in tests.
vi.mock("./jwt-magic-link", () => ({
  generateJti: () => "fresh-jti",
  signMagicLink: async () => "fake-token",
}));

const { dispatchJob } = await import("./cron-dispatch");

const sendCalls: Array<{ to: string; subject: string }> = [];
const sendEmail = async (
  to: string,
  email: { subject: string; text: string; html: string },
) => {
  sendCalls.push({ to, subject: email.subject });
};

const baseInput = {
  id: "job-id",
  bookingId: "booking-id",
  attempts: 1,
  origin: "https://www.archoslabs.xyz",
  sendEmail,
};

beforeEach(() => {
  mockBooking = {
    status: "confirmed",
    precallBriefSentAt: null,
    reminder24hSentAt: null,
    reminder1hSentAt: null,
    postcallFollowupSentAt: null,
    noshowRecoverySentAt: null,
    cancelJti: "test-jti",
  };
  sendCalls.length = 0;
  updateCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("dispatchJob — routing", () => {
  it("returns 'sent' for reminder_24h on the happy path", async () => {
    const outcome = await dispatchJob({ ...baseInput, kind: "reminder_24h" });
    expect(outcome.kind).toBe("sent");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].to).toBe("prospect@example.com");
  });

  it("returns 'sent' for reminder_1h on the happy path", async () => {
    const outcome = await dispatchJob({ ...baseInput, kind: "reminder_1h" });
    expect(outcome.kind).toBe("sent");
    expect(sendCalls[0].subject).toBe("In an hour");
  });

  it("returns 'sent' for precall_brief and addresses the consultant", async () => {
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "precall_brief",
    });
    expect(outcome.kind).toBe("sent");
    // Brief goes to the consultant, NOT the prospect.
    expect(sendCalls[0].to).toBe("rob.angeles@archoslabs.xyz");
    expect(sendCalls[0].subject).toContain("[ARCHOS BRIEF]");
  });

  it("returns 'sent' for postcall_followup on the happy path", async () => {
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "postcall_followup",
    });
    expect(outcome.kind).toBe("sent");
  });

  it("returns 'failed' for an unknown job kind", async () => {
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "made-up-kind",
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.error).toContain("Unknown job kind");
    }
  });

  it("skips confirmation jobs (already sent synchronously)", async () => {
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "confirmation",
    });
    expect(outcome.kind).toBe("skipped");
  });
});

describe("dispatchJob — universal skip on non-confirmed bookings", () => {
  it("skips reminder_24h when booking is cancelled", async () => {
    mockBooking.status = "cancelled";
    const outcome = await dispatchJob({ ...baseInput, kind: "reminder_24h" });
    expect(outcome.kind).toBe("skipped");
    expect(sendCalls).toHaveLength(0);
  });

  it("skips reminder_1h when booking is rescheduled_from", async () => {
    mockBooking.status = "rescheduled_from";
    const outcome = await dispatchJob({ ...baseInput, kind: "reminder_1h" });
    expect(outcome.kind).toBe("skipped");
  });

  it("skips precall_brief on a completed booking", async () => {
    mockBooking.status = "completed";
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "precall_brief",
    });
    expect(outcome.kind).toBe("skipped");
  });

  it("DOES NOT universal-skip noshow_recovery — it has its own status check", async () => {
    mockBooking.status = "no_show";
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "noshow_recovery",
    });
    expect(outcome.kind).toBe("sent");
  });
});

describe("dispatchJob — noshow_recovery specific status", () => {
  it("skips noshow_recovery on a confirmed booking (no-show wasn't marked)", async () => {
    mockBooking.status = "confirmed";
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "noshow_recovery",
    });
    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") {
      expect(outcome.reason).toContain("not no_show");
    }
  });

  it("sends noshow_recovery when status is no_show", async () => {
    mockBooking.status = "no_show";
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "noshow_recovery",
    });
    expect(outcome.kind).toBe("sent");
    expect(sendCalls[0].subject).toBe("Looks like we missed each other");
  });
});

describe("dispatchJob — already-sent dedup", () => {
  it("skips reminder_24h when reminder24hSentAt is already stamped", async () => {
    mockBooking.reminder24hSentAt = new Date();
    const outcome = await dispatchJob({ ...baseInput, kind: "reminder_24h" });
    expect(outcome.kind).toBe("skipped");
    expect(sendCalls).toHaveLength(0);
  });

  it("skips precall_brief when precallBriefSentAt is already stamped", async () => {
    mockBooking.precallBriefSentAt = new Date();
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "precall_brief",
    });
    expect(outcome.kind).toBe("skipped");
  });

  it("skips postcall_followup on second fire", async () => {
    mockBooking.postcallFollowupSentAt = new Date();
    const outcome = await dispatchJob({
      ...baseInput,
      kind: "postcall_followup",
    });
    expect(outcome.kind).toBe("skipped");
  });
});

describe("dispatchJob — missing booking", () => {
  it("skips when the booking is not found", async () => {
    // Override the mock to return an empty array.
    vi.doMock("./db", () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: () => ({ limit: async () => [] }),
            }),
          }),
        }),
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
      }),
    }));
    vi.resetModules();
    const { dispatchJob: freshDispatch } = await import("./cron-dispatch");
    const outcome = await freshDispatch({
      ...baseInput,
      kind: "reminder_24h",
    });
    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") {
      expect(outcome.reason).toContain("not found");
    }
  });
});
