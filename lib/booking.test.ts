import { describe, expect, it } from "vitest";
import {
  computeIdempotencyKey,
  createBookingInputSchema,
} from "./booking";

// Pure-function tests for lib/booking. DB-touching wrappers
// (createBookingRow, loadAvailableSlots, getConsultantBySlug) are
// covered by integration tests that land with the cron handler PR.

describe("computeIdempotencyKey", () => {
  it("produces the same key for the same email + slot", () => {
    const email = "rob@example.com";
    const slotStartUtc = new Date("2026-06-01T01:00:00Z");
    const a = computeIdempotencyKey({ email, slotStartUtc });
    const b = computeIdempotencyKey({ email, slotStartUtc });
    expect(a).toBe(b);
  });

  it("normalises email casing and whitespace", () => {
    const slotStartUtc = new Date("2026-06-01T01:00:00Z");
    const a = computeIdempotencyKey({
      email: "ROB@example.com  ",
      slotStartUtc,
    });
    const b = computeIdempotencyKey({
      email: "rob@example.com",
      slotStartUtc,
    });
    expect(a).toBe(b);
  });

  it("collapses two submits within the same 5-minute bucket", () => {
    const email = "rob@example.com";
    const a = computeIdempotencyKey({
      email,
      slotStartUtc: new Date("2026-06-01T01:00:00Z"),
    });
    const b = computeIdempotencyKey({
      email,
      slotStartUtc: new Date("2026-06-01T01:04:59Z"),
    });
    expect(a).toBe(b);
  });

  it("differs across a 5-minute bucket boundary", () => {
    const email = "rob@example.com";
    const a = computeIdempotencyKey({
      email,
      slotStartUtc: new Date("2026-06-01T01:00:00Z"),
    });
    const b = computeIdempotencyKey({
      email,
      slotStartUtc: new Date("2026-06-01T01:05:00Z"),
    });
    expect(a).not.toBe(b);
  });

  it("differs across different emails", () => {
    const slotStartUtc = new Date("2026-06-01T01:00:00Z");
    const a = computeIdempotencyKey({ email: "a@x.com", slotStartUtc });
    const b = computeIdempotencyKey({ email: "b@x.com", slotStartUtc });
    expect(a).not.toBe(b);
  });

  it("returns a 64-char hex digest", () => {
    const key = computeIdempotencyKey({
      email: "rob@example.com",
      slotStartUtc: new Date("2026-06-01T01:00:00Z"),
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createBookingInputSchema", () => {
  const valid = {
    slotStartUtc: "2026-06-01T01:00:00.000Z",
    slotEndUtc: "2026-06-01T01:30:00.000Z",
    name: "Rob Tester",
    email: "rob@example.com",
    organisation: "Archos Labs",
    position: "Founder",
    reasonInitial: "We need to talk about the migration risk on our AI program.",
    reasonFollowups: [],
    prospectTimezone: "Asia/Manila",
  };

  it("accepts the documented happy-path shape", () => {
    expect(createBookingInputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a follow-up Q+A entry", () => {
    const parsed = createBookingInputSchema.safeParse({
      ...valid,
      reasonFollowups: [{ question: "Q1?", answer: "A1." }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects more than two follow-up entries (hard cap)", () => {
    const parsed = createBookingInputSchema.safeParse({
      ...valid,
      reasonFollowups: [
        { question: "Q1?", answer: "A1." },
        { question: "Q2?", answer: "A2." },
        { question: "Q3?", answer: "A3." },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const parsed = createBookingInputSchema.safeParse({
      ...valid,
      email: "not-an-email",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a 3000-char reason (max 2000)", () => {
    const parsed = createBookingInputSchema.safeParse({
      ...valid,
      reasonInitial: "x".repeat(3000),
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts null organisation + position", () => {
    const parsed = createBookingInputSchema.safeParse({
      ...valid,
      organisation: null,
      position: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("defaults utm to empty object when omitted", () => {
    const parsed = createBookingInputSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.utm).toEqual({});
    }
  });
});
