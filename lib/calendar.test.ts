import { describe, expect, it } from "vitest";
import {
  generateSlots,
  workingHoursSchema,
  type ConsultantConfig,
  type GenerateSlotsInput,
} from "./calendar";

// All tests pin `now` to a known UTC instant so the slot grid is
// deterministic. The default config mirrors the production defaults in
// lib/db/schema.ts (consultant table) so tests double as docs.

const DEFAULT_CONFIG: ConsultantConfig = {
  timezone: "Asia/Manila", // UTC+8, no DST
  slotMinutes: 30,
  slotBufferMinutes: 15,
  advanceDays: 14,
  minNoticeHours: 24,
  workingHours: {
    mon: [9, 17],
    tue: [9, 17],
    wed: [9, 17],
    thu: [9, 17],
    fri: [9, 17],
  },
};

function defaults(overrides: Partial<GenerateSlotsInput> = {}): GenerateSlotsInput {
  return {
    config: DEFAULT_CONFIG,
    blackouts: [],
    bookings: [],
    freebusy: [],
    // Wed 2026-05-13 00:00 UTC = Wed 08:00 Manila — well before working hours,
    // so the min-notice window (+24h) lands Thu 08:00 Manila (just before open).
    now: new Date("2026-05-13T00:00:00Z"),
    ...overrides,
  };
}

describe("workingHoursSchema", () => {
  it("accepts the documented shape", () => {
    const parsed = workingHoursSchema.parse({
      mon: [9, 17],
      fri: [10, 16],
    });
    expect(parsed.mon).toEqual([9, 17]);
  });

  it("rejects non-integer hours", () => {
    expect(() => workingHoursSchema.parse({ mon: [9.5, 17] })).toThrow();
  });

  it("rejects out-of-range hours", () => {
    expect(() => workingHoursSchema.parse({ mon: [-1, 17] })).toThrow();
    expect(() => workingHoursSchema.parse({ mon: [9, 25] })).toThrow();
  });

  it("rejects unknown weekday keys", () => {
    expect(() => workingHoursSchema.parse({ funday: [9, 17] })).toThrow();
  });
});

describe("generateSlots — window edges", () => {
  it("returns no slots before now + minNoticeHours", () => {
    // now = Wed 00:00 UTC, minNotice 24h → earliest slot Thu 00:00 UTC = Thu 08:00 Manila.
    // Working hours open at 09:00 Manila = 01:00 UTC. So first slot must be ≥ 01:00 UTC Thu.
    const slots = generateSlots(defaults());
    const first = slots[0];
    expect(first).toBeDefined();
    expect(new Date(first!.startUtc).getTime()).toBeGreaterThanOrEqual(
      new Date("2026-05-14T01:00:00Z").getTime(),
    );
  });

  it("returns no slots after now + advanceDays", () => {
    const slots = generateSlots(defaults());
    const horizon = new Date("2026-05-13T00:00:00Z").getTime() + 14 * 86_400_000;
    for (const s of slots) {
      expect(new Date(s.endUtc).getTime()).toBeLessThanOrEqual(horizon);
    }
  });

  it("respects a 0-day advance window (empty)", () => {
    const slots = generateSlots(
      defaults({ config: { ...DEFAULT_CONFIG, advanceDays: 0 } }),
    );
    expect(slots).toEqual([]);
  });
});

describe("generateSlots — working hours", () => {
  it("only emits slots on weekdays defined in workingHours", () => {
    const slots = generateSlots(defaults());
    for (const s of slots) {
      const d = new Date(s.startUtc);
      // Manila tz at +8: just verify weekday via toLocaleDateString
      const weekday = d.toLocaleDateString("en-US", {
        timeZone: "Asia/Manila",
        weekday: "short",
      });
      expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(weekday);
    }
  });

  it("first slot of a working day starts at openHour:00 in consultant tz", () => {
    // Thu 2026-05-14, 09:00 Manila = 01:00 UTC.
    const slots = generateSlots(defaults());
    const thu = slots.find((s) =>
      new Date(s.startUtc).toLocaleDateString("en-US", {
        timeZone: "Asia/Manila",
      }).startsWith("5/14"),
    );
    expect(thu?.startUtc).toBe("2026-05-14T01:00:00.000Z");
  });

  it("last slot of a working day ends exactly at closeHour:00", () => {
    // Thu close at 17:00 Manila = 09:00 UTC. Last slot is 16:30→17:00 Manila = 08:30→09:00 UTC.
    const slots = generateSlots(defaults());
    const thursdaySlots = slots.filter((s) =>
      new Date(s.startUtc).toLocaleDateString("en-US", {
        timeZone: "Asia/Manila",
      }).startsWith("5/14"),
    );
    const last = thursdaySlots.at(-1);
    expect(last?.endUtc).toBe("2026-05-14T09:00:00.000Z");
  });

  it("explicit [9, 9] same-hour entry is treated as closed", () => {
    const slots = generateSlots(
      defaults({
        config: {
          ...DEFAULT_CONFIG,
          workingHours: { mon: [9, 9], tue: [9, 17] },
        },
      }),
    );
    for (const s of slots) {
      const weekday = new Date(s.startUtc).toLocaleDateString("en-US", {
        timeZone: "Asia/Manila",
        weekday: "short",
      });
      expect(weekday).not.toBe("Mon");
    }
  });
});

describe("generateSlots — blackouts", () => {
  it("removes slots intersecting a blackout window", () => {
    // Blackout Thu 09:00–11:00 Manila = 01:00–03:00 UTC.
    const slots = generateSlots(
      defaults({
        blackouts: [
          {
            startUtc: new Date("2026-05-14T01:00:00Z"),
            endUtc: new Date("2026-05-14T03:00:00Z"),
          },
        ],
      }),
    );
    for (const s of slots) {
      const startMs = new Date(s.startUtc).getTime();
      const endMs = new Date(s.endUtc).getTime();
      const blackoutStart = new Date("2026-05-14T01:00:00Z").getTime();
      const blackoutEnd = new Date("2026-05-14T03:00:00Z").getTime();
      const overlaps = startMs < blackoutEnd && blackoutStart < endMs;
      expect(overlaps).toBe(false);
    }
  });

  it("blackouts have no buffer (touching is not overlap)", () => {
    // Blackout ends exactly at the slot start — should NOT block.
    const blackoutEnd = new Date("2026-05-14T01:00:00Z");
    const slots = generateSlots(
      defaults({
        blackouts: [
          {
            startUtc: new Date("2026-05-14T00:00:00Z"),
            endUtc: blackoutEnd,
          },
        ],
      }),
    );
    expect(slots.find((s) => s.startUtc === blackoutEnd.toISOString())).toBeTruthy();
  });
});

describe("generateSlots — bookings + freebusy buffer", () => {
  it("adds slotBufferMinutes around an existing booking", () => {
    // Existing booking Thu 10:00–10:30 Manila = 02:00–02:30 UTC.
    // With 15-min buffer: 01:45–02:45 UTC is blocked.
    // So slots at 01:30 (ends 02:00), 02:00, 02:30 all conflict.
    // First clear slot starts at 02:45 UTC → next aligned slot is 03:00 UTC.
    const slots = generateSlots(
      defaults({
        bookings: [
          {
            startUtc: new Date("2026-05-14T02:00:00Z"),
            endUtc: new Date("2026-05-14T02:30:00Z"),
          },
        ],
      }),
    );
    expect(slots.find((s) => s.startUtc === "2026-05-14T01:30:00.000Z")).toBeUndefined();
    expect(slots.find((s) => s.startUtc === "2026-05-14T02:00:00.000Z")).toBeUndefined();
    expect(slots.find((s) => s.startUtc === "2026-05-14T02:30:00.000Z")).toBeUndefined();
    expect(slots.find((s) => s.startUtc === "2026-05-14T03:00:00.000Z")).toBeTruthy();
  });

  it("freebusy intervals are treated identically to bookings", () => {
    const slots = generateSlots(
      defaults({
        freebusy: [
          {
            startUtc: new Date("2026-05-14T02:00:00Z"),
            endUtc: new Date("2026-05-14T02:30:00Z"),
          },
        ],
      }),
    );
    expect(slots.find((s) => s.startUtc === "2026-05-14T02:00:00.000Z")).toBeUndefined();
    expect(slots.find((s) => s.startUtc === "2026-05-14T03:00:00.000Z")).toBeTruthy();
  });

  it("zero-buffer config still detects direct overlap", () => {
    const slots = generateSlots(
      defaults({
        config: { ...DEFAULT_CONFIG, slotBufferMinutes: 0 },
        bookings: [
          {
            startUtc: new Date("2026-05-14T02:00:00Z"),
            endUtc: new Date("2026-05-14T02:30:00Z"),
          },
        ],
      }),
    );
    expect(slots.find((s) => s.startUtc === "2026-05-14T02:00:00.000Z")).toBeUndefined();
    // Adjacent slots (ending exactly at booking start, starting exactly at booking end)
    // should be available with zero buffer.
    expect(slots.find((s) => s.startUtc === "2026-05-14T01:30:00.000Z")).toBeTruthy();
    expect(slots.find((s) => s.startUtc === "2026-05-14T02:30:00.000Z")).toBeTruthy();
  });
});

describe("generateSlots — DST", () => {
  it("spring-forward day in Europe/Berlin: skips the 2→3 wall-time gap", () => {
    // Europe/Berlin springs forward 2026-03-29 at 02:00 → 03:00 local.
    // Working hours 09–17 Berlin. The local 09:00 mark is at:
    //   - Before DST (Sat): UTC+1, so 09:00 Berlin = 08:00 UTC
    //   - After DST (Sun onward): UTC+2, so 09:00 Berlin = 07:00 UTC
    // Sunday is not in working hours, so we test Monday 2026-03-30:
    //   09:00 Berlin = 07:00 UTC (summer time). Pre-DST it would be 08:00.
    const config: ConsultantConfig = {
      ...DEFAULT_CONFIG,
      timezone: "Europe/Berlin",
    };
    const slots = generateSlots({
      config,
      blackouts: [],
      bookings: [],
      freebusy: [],
      now: new Date("2026-03-28T00:00:00Z"), // Sat before DST
    });
    const mondayFirst = slots.find((s) =>
      new Date(s.startUtc).toISOString().startsWith("2026-03-30"),
    );
    expect(mondayFirst?.startUtc).toBe("2026-03-30T07:00:00.000Z");
  });

  it("fall-back day in Europe/Berlin: 09:00 wall time still anchors correctly", () => {
    // Europe/Berlin falls back 2026-10-25 at 03:00 → 02:00 local.
    // Mon 2026-10-26 working hours start: 09:00 Berlin = 08:00 UTC (winter).
    // Friday 2026-10-23 (pre-flip): 09:00 Berlin = 07:00 UTC (summer).
    const config: ConsultantConfig = {
      ...DEFAULT_CONFIG,
      timezone: "Europe/Berlin",
    };
    const slots = generateSlots({
      config,
      blackouts: [],
      bookings: [],
      freebusy: [],
      now: new Date("2026-10-22T00:00:00Z"),
    });
    const friday = slots.find((s) =>
      new Date(s.startUtc).toISOString().startsWith("2026-10-23"),
    );
    const monday = slots.find((s) =>
      new Date(s.startUtc).toISOString().startsWith("2026-10-26"),
    );
    expect(friday?.startUtc).toBe("2026-10-23T07:00:00.000Z"); // CEST
    expect(monday?.startUtc).toBe("2026-10-26T08:00:00.000Z"); // CET
  });
});

describe("generateSlots — slot stepping", () => {
  it("emits slots in slotMinutes increments", () => {
    const slots = generateSlots(defaults());
    for (let i = 1; i < slots.length; i++) {
      const prev = new Date(slots[i - 1].startUtc).getTime();
      const cur = new Date(slots[i].startUtc).getTime();
      const delta = cur - prev;
      // Within a day: 30 min. Across an unavailable evening: > 30 min.
      // We just check the delta is a multiple of slot length.
      expect(delta % (30 * 60_000)).toBe(0);
    }
  });

  it("each slot is exactly slotMinutes long", () => {
    const slots = generateSlots(defaults());
    for (const s of slots) {
      const dur = new Date(s.endUtc).getTime() - new Date(s.startUtc).getTime();
      expect(dur).toBe(30 * 60_000);
    }
  });

  it("custom slot length (60 minutes) produces 60-minute slots", () => {
    const slots = generateSlots(
      defaults({ config: { ...DEFAULT_CONFIG, slotMinutes: 60 } }),
    );
    for (const s of slots) {
      const dur = new Date(s.endUtc).getTime() - new Date(s.startUtc).getTime();
      expect(dur).toBe(60 * 60_000);
    }
  });
});

describe("generateSlots — empty config edge cases", () => {
  it("empty workingHours produces no slots", () => {
    const slots = generateSlots(
      defaults({ config: { ...DEFAULT_CONFIG, workingHours: {} } }),
    );
    expect(slots).toEqual([]);
  });

  it("min-notice that exceeds advance-days produces no slots", () => {
    const slots = generateSlots(
      defaults({
        config: { ...DEFAULT_CONFIG, minNoticeHours: 24 * 30, advanceDays: 14 },
      }),
    );
    expect(slots).toEqual([]);
  });
});
