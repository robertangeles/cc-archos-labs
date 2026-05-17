import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOKING_PROMPTS_STARTER,
  BookingPromptsSchema,
} from "./booking-prompts-shared";

// Mutable stub for the DB query. Tests set this to simulate
// "row exists" / "row missing" / "row malformed" cases.
let dbResult: { value: unknown }[] = [];
let dbThrows = false;

vi.mock("./db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (dbThrows) throw new Error("DB unreachable (test)");
            return dbResult;
          },
        }),
      }),
    }),
  }),
}));

const { getBookingPrompts } = await import("./booking-prompts");

beforeEach(() => {
  dbResult = [];
  dbThrows = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BookingPromptsSchema", () => {
  it("accepts the documented starter shape", () => {
    expect(
      BookingPromptsSchema.safeParse(BOOKING_PROMPTS_STARTER).success,
    ).toBe(true);
  });

  it("rejects a prompt with fewer than 50 chars", () => {
    const parsed = BookingPromptsSchema.safeParse({
      ...BOOKING_PROMPTS_STARTER,
      followup: { systemPrompt: "too short", version: "v1" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing version label", () => {
    const parsed = BookingPromptsSchema.safeParse({
      ...BOOKING_PROMPTS_STARTER,
      brief: {
        ...BOOKING_PROMPTS_STARTER.brief,
        version: "",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects missing prompts (all three required)", () => {
    const parsed = BookingPromptsSchema.safeParse({
      followup: BOOKING_PROMPTS_STARTER.followup,
      brief: BOOKING_PROMPTS_STARTER.brief,
      // blogMatch omitted
    });
    expect(parsed.success).toBe(false);
  });
});

describe("getBookingPrompts — fallback semantics", () => {
  it("returns the hardcoded starter when the DB row is missing", async () => {
    dbResult = [];
    const result = await getBookingPrompts();
    expect(result).toEqual(BOOKING_PROMPTS_STARTER);
  });

  it("returns the hardcoded starter when the DB is unreachable", async () => {
    dbThrows = true;
    const result = await getBookingPrompts();
    expect(result).toEqual(BOOKING_PROMPTS_STARTER);
  });

  it("returns the hardcoded starter when the stored value is malformed", async () => {
    dbResult = [{ value: { garbage: "shape" } }];
    const result = await getBookingPrompts();
    expect(result).toEqual(BOOKING_PROMPTS_STARTER);
  });

  it("returns the stored prompts when the DB row is valid", async () => {
    const stored = {
      followup: {
        systemPrompt:
          "ADMIN-CUSTOM FOLLOWUP PROMPT — this is a long enough string to clear the min(50) Zod check on the schema.",
        version: "admin-v2",
      },
      brief: {
        systemPrompt:
          "ADMIN-CUSTOM BRIEF PROMPT — this is also a long enough string to clear the min(50) Zod check on the schema.",
        version: "admin-v2",
      },
      blogMatch: {
        systemPrompt:
          "ADMIN-CUSTOM BLOG MATCH PROMPT — and this one too, long enough to clear the min(50) Zod check.",
        version: "admin-v2",
      },
    };
    dbResult = [{ value: stored }];
    const result = await getBookingPrompts();
    expect(result).toEqual(stored);
    // Starter is untouched (sanity-check the test setup didn't leak):
    expect(result).not.toEqual(BOOKING_PROMPTS_STARTER);
  });
});
