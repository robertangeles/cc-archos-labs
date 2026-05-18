import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Captures every db.update().set().where().returning() call so tests can
// inspect the cutoff math + return-shape plumbing. Pure SQL semantics
// (does it actually null the right rows on a real Postgres?) are deferred
// to integration testing — same pattern as lib/scheduler.test.ts.
//
// The chain mirrors what Drizzle's typed builder exposes: each method
// returns the next link, and .returning() resolves to the array of
// affected-row id objects.

const setCalls: Array<Record<string, unknown>> = [];
let mockReturning: Array<{ id: string }> = [];

vi.mock("../db", () => ({
  getDb: () => ({
    update: () => ({
      set: (sets: Record<string, unknown>) => {
        setCalls.push(sets);
        return {
          where: () => ({
            returning: async () => mockReturning,
          }),
        };
      },
    }),
  }),
}));

const {
  SESSION_METADATA_RETENTION_DAYS,
  purgeOldSessionMetadata,
} = await import("./purge-session-metadata");

beforeEach(() => {
  setCalls.length = 0;
  mockReturning = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SESSION_METADATA_RETENTION_DAYS", () => {
  // Coupled to /privacy page text. If this changes, /privacy must change
  // too — the constant + the published policy must always match.
  it("is 30 days (matches published privacy policy)", () => {
    expect(SESSION_METADATA_RETENTION_DAYS).toBe(30);
  });
});

describe("purgeOldSessionMetadata", () => {
  it("returns rowsAffected from the DB and the cutoff timestamp", async () => {
    mockReturning = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const now = new Date("2026-05-18T03:00:00Z");
    const result = await purgeOldSessionMetadata({ now });
    expect(result.rowsAffected).toBe(3);
    // Cutoff is exactly 30 days before `now`.
    expect(result.cutoffAt).toBe("2026-04-18T03:00:00.000Z");
  });

  it("returns 0 when no rows match (idempotent rerun)", async () => {
    mockReturning = [];
    const result = await purgeOldSessionMetadata({
      now: new Date("2026-05-18T03:00:00Z"),
    });
    expect(result.rowsAffected).toBe(0);
  });

  it("nulls ip_address + user_agent + bumps updated_at in one SET", async () => {
    const now = new Date("2026-05-18T03:00:00Z");
    await purgeOldSessionMetadata({ now });
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual({
      ipAddress: null,
      userAgent: null,
      updatedAt: now,
    });
  });

  it("uses current time when `now` is not supplied", async () => {
    const before = Date.now();
    const result = await purgeOldSessionMetadata();
    const after = Date.now();
    const cutoffMs = new Date(result.cutoffAt).getTime();
    const windowMs = SESSION_METADATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(before - windowMs);
    expect(cutoffMs).toBeLessThanOrEqual(after - windowMs);
  });
});
