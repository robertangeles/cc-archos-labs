import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Captures every db.execute() call so tests can inspect the SQL fragment
// values the lib produced. The pure SQL semantics (does it actually null
// the right rows?) are deferred to integration testing against real
// Postgres — same pattern as lib/scheduler.test.ts.
const executeCalls: Array<unknown> = [];
let mockRowsAffected = 0;

vi.mock("../db", () => ({
  getDb: () => ({
    execute: async (q: unknown) => {
      executeCalls.push(q);
      return { count: mockRowsAffected };
    },
  }),
}));

const {
  SESSION_METADATA_RETENTION_DAYS,
  purgeOldSessionMetadata,
} = await import("./purge-session-metadata");

beforeEach(() => {
  executeCalls.length = 0;
  mockRowsAffected = 0;
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
    mockRowsAffected = 7;
    const now = new Date("2026-05-18T03:00:00Z");
    const result = await purgeOldSessionMetadata({ now });
    expect(result.rowsAffected).toBe(7);
    // Cutoff is exactly 30 days before `now`.
    expect(result.cutoffAt).toBe("2026-04-18T03:00:00.000Z");
  });

  it("returns 0 when no rows match (idempotent rerun)", async () => {
    mockRowsAffected = 0;
    const result = await purgeOldSessionMetadata({
      now: new Date("2026-05-18T03:00:00Z"),
    });
    expect(result.rowsAffected).toBe(0);
  });

  it("issues exactly one UPDATE per call", async () => {
    await purgeOldSessionMetadata({
      now: new Date("2026-05-18T03:00:00Z"),
    });
    expect(executeCalls).toHaveLength(1);
  });

  it("uses current time when `now` is not supplied", async () => {
    const before = Date.now();
    const result = await purgeOldSessionMetadata();
    const after = Date.now();
    const cutoffMs = new Date(result.cutoffAt).getTime();
    const windowMs = SESSION_METADATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    // cutoff sits between (before - 30d) and (after - 30d).
    expect(cutoffMs).toBeGreaterThanOrEqual(before - windowMs);
    expect(cutoffMs).toBeLessThanOrEqual(after - windowMs);
  });
});
