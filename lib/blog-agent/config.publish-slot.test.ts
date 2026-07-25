import { describe, expect, it } from "vitest";
import { nextPublishSlot } from "./config";

// "7am AEST" is not as simple as UTC+10. Sydney observes daylight saving, so a
// fixed +10 offset would drift to 8am local for half the year. These assert
// wall-clock behaviour instead: 7am is 7am, whatever the offset happens to be.

/** What the given instant reads as on a clock in that zone. */
function localTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const SYD = "Australia/Sydney";
const BNE = "Australia/Brisbane";

describe("nextPublishSlot", () => {
  it("picks today's 7am when the run happens overnight", () => {
    // 03:00 Sydney on 26 July (AEST, UTC+10) = 17:00 UTC on the 25th.
    const now = new Date("2026-07-25T17:00:00Z");
    const slot = nextPublishSlot(now, 7, SYD);
    expect(localTime(slot, SYD)).toBe("26/07/2026, 07:00");
  });

  it("rolls to tomorrow when 7am has already passed", () => {
    // 09:00 Sydney — today's slot is gone.
    const now = new Date("2026-07-25T23:00:00Z");
    const slot = nextPublishSlot(now, 7, SYD);
    expect(localTime(slot, SYD)).toBe("27/07/2026, 07:00");
  });

  it("is always strictly in the future", () => {
    // PostCreateSchema rejects a past scheduledPublishAt, and the run itself
    // takes minutes, so a slot equal to "now" would fail the save.
    for (const iso of [
      "2026-07-25T20:59:00Z",
      "2026-07-25T21:00:00Z",
      "2026-07-25T21:01:00Z",
    ]) {
      const now = new Date(iso);
      expect(nextPublishSlot(now, 7, SYD).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("holds 7am local across the AEDT changeover", () => {
    // Sydney springs forward on the first Sunday of October. Winter is UTC+10,
    // summer UTC+11 — a hardcoded +10 would silently become 8am local here.
    const winter = nextPublishSlot(new Date("2026-06-15T00:00:00Z"), 7, SYD);
    const summer = nextPublishSlot(new Date("2026-12-15T00:00:00Z"), 7, SYD);

    expect(localTime(winter, SYD)).toMatch(/07:00$/);
    expect(localTime(summer, SYD)).toMatch(/07:00$/);

    // Same wall clock, different UTC hour — that is the whole point.
    expect(winter.getUTCHours()).not.toBe(summer.getUTCHours());
  });

  it("gives a fixed UTC+10 all year in Brisbane, which has no daylight saving", () => {
    const winter = nextPublishSlot(new Date("2026-06-15T00:00:00Z"), 7, BNE);
    const summer = nextPublishSlot(new Date("2026-12-15T00:00:00Z"), 7, BNE);

    expect(localTime(winter, BNE)).toMatch(/07:00$/);
    expect(localTime(summer, BNE)).toMatch(/07:00$/);
    // 7am UTC+10 is 21:00 UTC the previous day, in both seasons.
    expect(winter.getUTCHours()).toBe(21);
    expect(summer.getUTCHours()).toBe(21);
  });

  it("lands exactly on the hour, never a minute past", () => {
    const slot = nextPublishSlot(new Date("2026-07-25T17:00:00Z"), 7, SYD);
    expect(slot.getUTCMinutes()).toBe(0);
    expect(slot.getUTCSeconds()).toBe(0);
  });

  it("honours a different hour", () => {
    const slot = nextPublishSlot(new Date("2026-07-25T17:00:00Z"), 18, SYD);
    expect(localTime(slot, SYD)).toBe("26/07/2026, 18:00");
  });
});
