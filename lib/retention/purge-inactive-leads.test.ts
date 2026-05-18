import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the typed Drizzle chain inside a transaction:
//   tx.select().from().where()       → resolves to inactive-lead rows
//   tx.delete().where().returning()  → resolves to deleted-row id arrays
// (called twice: once for sessions, once for leads)
//
// Pure SQL semantics (does the NOT EXISTS subquery actually pick the
// right leads on a real Postgres?) are deferred to integration testing —
// same pattern as lib/scheduler.test.ts.

let mockInactiveLeads: Array<{ id: string }> = [];
let mockSessionDeletes: Array<{ id: string }> = [];
let mockLeadDeletes: Array<{ id: string }> = [];
let deleteCallCount = 0;

vi.mock("../db", () => ({
  getDb: () => ({
    transaction: async (
      callback: (tx: {
        select: () => {
          from: () => {
            where: () => Promise<Array<{ id: string }>>;
          };
        };
        delete: () => {
          where: () => {
            returning: () => Promise<Array<{ id: string }>>;
          };
        };
      }) => Promise<unknown>,
    ) => {
      return callback({
        select: () => ({
          from: () => ({
            where: async () => mockInactiveLeads,
          }),
        }),
        delete: () => ({
          where: () => ({
            returning: async () => {
              // First delete call is sessions, second is leads.
              const result =
                deleteCallCount === 0 ? mockSessionDeletes : mockLeadDeletes;
              deleteCallCount++;
              return result;
            },
          }),
        }),
      });
    },
  }),
}));

const {
  LEAD_INACTIVITY_RETENTION_MONTHS,
  purgeInactiveLeads,
} = await import("./purge-inactive-leads");

beforeEach(() => {
  mockInactiveLeads = [];
  mockSessionDeletes = [];
  mockLeadDeletes = [];
  deleteCallCount = 0;
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
    mockInactiveLeads = [{ id: "l1" }, { id: "l2" }];
    mockSessionDeletes = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    mockLeadDeletes = [{ id: "l1" }, { id: "l2" }];
    const now = new Date("2026-05-18T03:00:00Z");
    const result = await purgeInactiveLeads({ now });
    expect(result.sessionsDeleted).toBe(3);
    expect(result.leadsDeleted).toBe(2);
    // Cutoff is 24 * 30 days before `now` (lib uses a 30-day-month
    // approximation; ±a few days is irrelevant at a 24-month window).
    const expectedCutoffMs =
      now.getTime() - 24 * 30 * 24 * 60 * 60 * 1000;
    expect(new Date(result.cutoffAt).getTime()).toBe(expectedCutoffMs);
  });

  it("returns 0s when no leads match (idempotent rerun, no DELETEs)", async () => {
    mockInactiveLeads = [];
    const result = await purgeInactiveLeads({
      now: new Date("2026-05-18T03:00:00Z"),
    });
    expect(result.sessionsDeleted).toBe(0);
    expect(result.leadsDeleted).toBe(0);
    // Early-return short-circuits the two DELETE calls.
    expect(deleteCallCount).toBe(0);
  });

  it("issues two DELETEs when at least one lead is inactive", async () => {
    mockInactiveLeads = [{ id: "l1" }];
    mockSessionDeletes = [];
    mockLeadDeletes = [{ id: "l1" }];
    await purgeInactiveLeads({
      now: new Date("2026-05-18T03:00:00Z"),
    });
    expect(deleteCallCount).toBe(2);
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
