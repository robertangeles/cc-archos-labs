import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Captures every tx.execute() call inside the transaction so tests can
// verify the two-step delete sequence ran. SQL semantics (does it
// actually purge the right leads?) are deferred to integration testing
// against real Postgres — same pattern as lib/scheduler.test.ts.
const executeCalls: Array<unknown> = [];
let mockSessionDeleteCount = 0;
let mockLeadDeleteCount = 0;

vi.mock("../db", () => ({
  getDb: () => ({
    transaction: async (
      callback: (tx: {
        execute: (q: unknown) => Promise<{ count: number }>;
      }) => Promise<unknown>,
    ) => {
      let callIndex = 0;
      return callback({
        execute: async (q: unknown) => {
          executeCalls.push(q);
          // First DELETE in the lib is sessions, second is leads.
          const count = callIndex === 0 ? mockSessionDeleteCount : mockLeadDeleteCount;
          callIndex++;
          return { count };
        },
      });
    },
  }),
}));

const {
  LEAD_INACTIVITY_RETENTION_MONTHS,
  purgeInactiveLeads,
} = await import("./purge-inactive-leads");

beforeEach(() => {
  executeCalls.length = 0;
  mockSessionDeleteCount = 0;
  mockLeadDeleteCount = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LEAD_INACTIVITY_RETENTION_MONTHS", () => {
  // Coupled to /privacy page text. If this changes, /privacy must change
  // too — the constant + the published policy must always match.
  it("is 24 months (matches published privacy policy)", () => {
    expect(LEAD_INACTIVITY_RETENTION_MONTHS).toBe(24);
  });
});

describe("purgeInactiveLeads", () => {
  it("returns leadsDeleted + sessionsDeleted + cutoffAt", async () => {
    mockSessionDeleteCount = 12;
    mockLeadDeleteCount = 4;
    const now = new Date("2026-05-18T03:00:00Z");
    const result = await purgeInactiveLeads({ now });
    expect(result.sessionsDeleted).toBe(12);
    expect(result.leadsDeleted).toBe(4);
    // Cutoff is 24 * 30 days before `now` (lib uses 30-day-month
    // approximation; close enough for a 24-month retention window where
    // ±a few days does not matter to anyone).
    const expectedCutoffMs =
      now.getTime() - 24 * 30 * 24 * 60 * 60 * 1000;
    expect(new Date(result.cutoffAt).getTime()).toBe(expectedCutoffMs);
  });

  it("returns 0s when no leads match (idempotent rerun)", async () => {
    mockSessionDeleteCount = 0;
    mockLeadDeleteCount = 0;
    const result = await purgeInactiveLeads({
      now: new Date("2026-05-18T03:00:00Z"),
    });
    expect(result.sessionsDeleted).toBe(0);
    expect(result.leadsDeleted).toBe(0);
  });

  it("runs both DELETEs inside a single transaction", async () => {
    await purgeInactiveLeads({
      now: new Date("2026-05-18T03:00:00Z"),
    });
    // Two execute calls: DELETE sessions, then DELETE leads.
    expect(executeCalls).toHaveLength(2);
  });

  it("uses current time when `now` is not supplied", async () => {
    const before = Date.now();
    const result = await purgeInactiveLeads();
    const after = Date.now();
    const cutoffMs = new Date(result.cutoffAt).getTime();
    const windowMs = 24 * 30 * 24 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(before - windowMs);
    expect(cutoffMs).toBeLessThanOrEqual(after - windowMs);
  });
});
