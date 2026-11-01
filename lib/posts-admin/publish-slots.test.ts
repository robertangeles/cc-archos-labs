import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePostTestDb, type PostTestDb } from "../../tests/helpers/post-test-db";
import {
  DEFAULT_PUBLISH_SLOTS,
  getPublishSlots,
  nextFreeSlot,
  nextPublishSlot,
  parsePublishSlots,
  PublishSlotsConfigError,
  slotInstant,
} from "./publish-slots";

// The slots are wall-clock times in a named zone, so the whole risk is daylight
// saving: 9:00 in New York is 13:00 UTC in summer and 14:00 UTC in winter. The
// US clocks changed on 2026-03-08 and 2026-11-01, and both days are tested.

const NY = DEFAULT_PUBLISH_SLOTS;
const iso = (d: Date) => d.toISOString();

describe("parsePublishSlots", () => {
  it("accepts the default", () => {
    expect(parsePublishSlots({ timeZone: "America/New_York", times: ["09:00", "15:00", "21:00"] })).toEqual(NY);
  });

  it("sorts and de-duplicates the times", () => {
    expect(parsePublishSlots({ timeZone: "America/New_York", times: ["21:00", "09:00", "09:00"] }).times).toEqual([
      "09:00",
      "21:00",
    ]);
  });

  it.each([
    ["an unknown zone", { timeZone: "Mars/Phobos", times: ["09:00"] }],
    ["a missing zone", { times: ["09:00"] }],
    ["no times", { timeZone: "America/New_York", times: [] }],
    ["nine times", { timeZone: "America/New_York", times: Array.from({ length: 9 }, (_, i) => `0${i}:00`) }],
    ["12-hour text", { timeZone: "America/New_York", times: ["9am"] }],
    ["hour 24", { timeZone: "America/New_York", times: ["24:00"] }],
    ["minute 60", { timeZone: "America/New_York", times: ["09:60"] }],
    ["a missing leading zero", { timeZone: "America/New_York", times: ["9:00"] }],
    ["a string", "09:00"],
    ["null", null],
  ])("rejects %s", (_label, raw) => {
    expect(() => parsePublishSlots(raw)).toThrow(PublishSlotsConfigError);
  });
});

describe("slotInstant", () => {
  it.each([
    ["summer (EDT, UTC-4)", [2026, 10, 29], "09:00", "2026-10-29T13:00:00.000Z"],
    ["winter (EST, UTC-5)", [2026, 11, 2], "09:00", "2026-11-02T14:00:00.000Z"],
    ["the day clocks fell back, morning", [2026, 11, 1], "09:00", "2026-11-01T14:00:00.000Z"],
    ["the night before they fell back", [2026, 10, 31], "21:00", "2026-11-01T01:00:00.000Z"],
    ["the day clocks sprang forward, morning", [2026, 3, 8], "09:00", "2026-03-08T13:00:00.000Z"],
    ["the night before they sprang forward", [2026, 3, 7], "21:00", "2026-03-08T02:00:00.000Z"],
  ])("9/21 New York on %s", (_label, [y, m, d], time, expected) => {
    expect(iso(slotInstant(y as number, m as number, d as number, time as string, "America/New_York")!)).toBe(expected);
  });

  it("works for another zone, so the zone really is the setting", () => {
    // Melbourne is UTC+11 on 2026-10-29.
    expect(iso(slotInstant(2026, 10, 29, "09:00", "Australia/Melbourne")!)).toBe("2026-10-28T22:00:00.000Z");
  });

  it("returns null for a local time that does not exist (the spring-forward gap)", () => {
    expect(slotInstant(2026, 3, 8, "02:30", "America/New_York")).toBeNull();
  });
});

describe("nextFreeSlot", () => {
  const at = (s: string) => new Date(s);

  it("picks 9:00 on the same day when it is earlier than 9:00", () => {
    // 08:00 EDT
    expect(iso(nextFreeSlot(at("2026-10-29T12:00:00Z"), [], NY))).toBe("2026-10-29T13:00:00.000Z");
  });

  it("steps through the day: 9:00, then 15:00, then 21:00, then tomorrow 9:00", () => {
    expect(iso(nextFreeSlot(at("2026-10-29T13:01:00Z"), [], NY))).toBe("2026-10-29T19:00:00.000Z"); // 15:00 EDT
    expect(iso(nextFreeSlot(at("2026-10-29T19:01:00Z"), [], NY))).toBe("2026-10-30T01:00:00.000Z"); // 21:00 EDT
    expect(iso(nextFreeSlot(at("2026-10-30T01:01:00Z"), [], NY))).toBe("2026-10-30T13:00:00.000Z"); // 9:00 EDT next day
  });

  it("uses the New York date, not the UTC date", () => {
    // 2026-10-30T00:30Z is 20:30 on 29 Oct in New York: UTC has already rolled to
    // the 30th, but tonight's 21:00 slot (01:00Z) is still ahead. Counting days
    // in UTC would skip it and return 9:00 the next morning.
    expect(iso(nextFreeSlot(at("2026-10-30T00:30:00Z"), [], NY))).toBe("2026-10-30T01:00:00.000Z");
  });

  it("is not fooled by the clocks changing: winter slots are an hour later in UTC", () => {
    // 08:30 EST on 2 Nov
    expect(iso(nextFreeSlot(at("2026-11-02T13:30:00Z"), [], NY))).toBe("2026-11-02T14:00:00.000Z");
  });

  it("is strictly after the given time", () => {
    expect(iso(nextFreeSlot(at("2026-10-29T13:00:00Z"), [], NY))).toBe("2026-10-29T19:00:00.000Z");
  });

  it("skips slots that are already taken", () => {
    const taken = [at("2026-10-29T13:00:00Z"), at("2026-10-29T19:00:00Z")];
    expect(iso(nextFreeSlot(at("2026-10-29T12:00:00Z"), taken, NY))).toBe("2026-10-30T01:00:00.000Z");
  });

  // Every New York slot for `days` days from 29 Oct 2026, built with the same
  // zone maths the code uses, so the week that crosses the 1 Nov clock change
  // is booked at the right UTC hours.
  const bookDays = (days: number): Date[] => {
    const taken: Date[] = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.UTC(2026, 9, 29 + i));
      for (const t of NY.times) {
        taken.push(slotInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), t, NY.timeZone)!);
      }
    }
    return taken;
  };

  it("rolls to later days when every slot for a week is taken, across the clock change", () => {
    // 29 Oct..4 Nov are all booked; the next free slot is 9:00 on 5 Nov (EST, 14:00Z).
    expect(iso(nextFreeSlot(at("2026-10-29T12:00:00Z"), bookDays(7), NY))).toBe("2026-11-05T14:00:00.000Z");
  });

  it("throws when nothing is free inside the horizon, instead of looping", () => {
    expect(() => nextFreeSlot(at("2026-10-29T12:00:00Z"), bookDays(12), NY, { horizonDays: 5 })).toThrow(/no free/i);
  });

  it("every slot lands exactly on the minute", () => {
    expect(nextFreeSlot(at("2026-10-29T12:00:17.123Z"), [], NY).getUTCSeconds()).toBe(0);
  });
});

describe("getPublishSlots and nextPublishSlot (against a real Postgres engine)", () => {
  let h: PostTestDb;
  beforeEach(async () => {
    h = await makePostTestDb();
    await h.client.query(`
      CREATE TABLE IF NOT EXISTS "site_setting" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "key" text NOT NULL UNIQUE,
        "value" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
  });
  afterEach(async () => {
    await h.close();
  });
  const setSlots = (value: unknown) =>
    h.client.query(`INSERT INTO "site_setting" ("key","value") VALUES ('blog_publish_slots', $1::jsonb)`, [JSON.stringify(value)]);

  it("falls back to 9:00, 15:00 and 21:00 New York when nothing is configured", async () => {
    expect(await getPublishSlots(h.db)).toEqual(NY);
  });

  it("reads the configured schedule", async () => {
    await setSlots({ timeZone: "America/Chicago", times: ["08:00", "20:00"] });
    expect(await getPublishSlots(h.db)).toEqual({ timeZone: "America/Chicago", times: ["08:00", "20:00"] });
  });

  it("fails loudly on a broken setting instead of quietly scheduling at the wrong times", async () => {
    await setSlots({ timeZone: "America/New_York", times: ["nine"] });
    await expect(getPublishSlots(h.db)).rejects.toThrow(PublishSlotsConfigError);
  });

  it("picks the next free slot and skips ones held by scheduled posts", async () => {
    await h.createPost({ status: "scheduled", scheduledPublishAt: new Date("2026-10-29T13:00:00Z") });
    await h.createPost({ status: "scheduled", scheduledPublishAt: new Date("2026-10-29T19:00:00Z") });
    // 08:00 EDT: 9:00 and 15:00 are held, so 21:00 is next.
    expect(iso(await nextPublishSlot(h.db, new Date("2026-10-29T12:00:00Z")))).toBe("2026-10-30T01:00:00.000Z");
  });

  it("ignores drafts, published posts and slots already in the past", async () => {
    await h.createPost({ status: "draft", scheduledPublishAt: null });
    await h.createPost({ status: "published", scheduledPublishAt: new Date("2026-10-29T13:00:00Z") });
    await h.createPost({ status: "scheduled", scheduledPublishAt: new Date("2026-10-28T13:00:00Z") });
    expect(iso(await nextPublishSlot(h.db, new Date("2026-10-29T12:00:00Z")))).toBe("2026-10-29T13:00:00.000Z");
  });

  it("will not hand out a slot that is about to pass: 08:59 gives 15:00, not 9:00", async () => {
    // 08:59 EDT is 12:59Z, so the 9:00 slot is one minute away, inside the 2 minute lead.
    expect(iso(await nextPublishSlot(h.db, new Date("2026-10-29T12:59:00Z")))).toBe("2026-10-29T19:00:00.000Z");
  });

  it("uses the configured zone", async () => {
    await setSlots({ timeZone: "Australia/Melbourne", times: ["09:00"] });
    // 2026-10-29 09:00 AEDT = 2026-10-28T22:00Z; from 2026-10-28T20:00Z that is next.
    expect(iso(await nextPublishSlot(h.db, new Date("2026-10-28T20:00:00Z")))).toBe("2026-10-28T22:00:00.000Z");
  });
});
