import { describe, expect, it } from "vitest";
import { nextFreeSlot, nextPublishSlot } from "./config";

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

describe("nextFreeSlot — three slots a day", () => {
  // Observed in DEV: five real posts stacked on one 7am. nextPublishSlot
  // answers "when is the next 7am", which is not "when is the next free slot"
  // — and with three a day the stream is 7am, 2pm, 10pm, 7am…
  const HOURS = [7, 14, 22];
  const NIGHT = new Date("2026-07-25T17:00:00Z"); // 3am Sydney on the 26th

  it("takes the soonest configured hour, not the first one listed", () => {
    // 3am Sydney: the next slot is that morning's 7am.
    expect(localTime(nextFreeSlot(NIGHT, HOURS, SYD, []), SYD)).toBe(
      "26/07/2026, 07:00",
    );
  });

  it("walks 7am to 2pm to 10pm within the same day", () => {
    const first = nextFreeSlot(NIGHT, HOURS, SYD, []);
    const second = nextFreeSlot(NIGHT, HOURS, SYD, [first]);
    const third = nextFreeSlot(NIGHT, HOURS, SYD, [first, second]);
    expect(localTime(first, SYD)).toBe("26/07/2026, 07:00");
    expect(localTime(second, SYD)).toBe("26/07/2026, 14:00");
    expect(localTime(third, SYD)).toBe("26/07/2026, 22:00");
  });

  it("rolls to the next morning once the day is full", () => {
    const taken: Date[] = [];
    for (let i = 0; i < 3; i++) taken.push(nextFreeSlot(NIGHT, HOURS, SYD, taken));
    expect(localTime(nextFreeSlot(NIGHT, HOURS, SYD, taken), SYD)).toBe(
      "27/07/2026, 07:00",
    );
  });

  it("gives nine posts nine distinct slots over three days", () => {
    // This is the failure that prompted it: five posts, one instant.
    const taken: Date[] = [];
    for (let i = 0; i < 9; i++) taken.push(nextFreeSlot(NIGHT, HOURS, SYD, taken));
    expect(new Set(taken.map((d) => d.getTime())).size).toBe(9);
    expect(localTime(taken[8], SYD)).toBe("28/07/2026, 22:00");
  });

  it("skips a slot a human already scheduled", () => {
    const morning = nextFreeSlot(NIGHT, HOURS, SYD, []);
    expect(localTime(nextFreeSlot(NIGHT, HOURS, SYD, [morning]), SYD)).toBe(
      "26/07/2026, 14:00",
    );
  });

  it("ignores a claimed time that is not one of the slots", () => {
    const odd = new Date("2026-07-26T23:15:00Z");
    expect(nextFreeSlot(NIGHT, HOURS, SYD, [odd]).getTime()).toBe(
      nextPublishSlot(NIGHT, 7, SYD).getTime(),
    );
  });

  it("holds every slot's wall clock across the daylight-saving change", () => {
    // Stepping by a fixed 24 hours would drift these to 6am/1pm/9pm.
    const before = new Date("2026-10-02T12:00:00Z");
    const taken: Date[] = [];
    for (let i = 0; i < 9; i++) taken.push(nextFreeSlot(before, HOURS, SYD, taken));
    for (const d of taken) {
      expect(localTime(d, SYD)).toMatch(/(07|14|22):00$/);
    }
  });

  it("still works with a single configured hour", () => {
    const first = nextFreeSlot(NIGHT, [7], SYD, []);
    expect(localTime(nextFreeSlot(NIGHT, [7], SYD, [first]), SYD)).toBe(
      "27/07/2026, 07:00",
    );
  });

  it("gives up after the horizon rather than looping forever", () => {
    const taken: Date[] = [];
    for (let i = 0; i < 40; i++) taken.push(nextFreeSlot(NIGHT, HOURS, SYD, taken));
    const out = nextFreeSlot(NIGHT, HOURS, SYD, taken, 5);
    expect(out).toBeInstanceOf(Date);
    expect(out.getTime()).toBeGreaterThan(NIGHT.getTime());
  });

  it("is always strictly in the future", () => {
    const first = nextFreeSlot(NIGHT, HOURS, SYD, []);
    expect(nextFreeSlot(NIGHT, HOURS, SYD, [first]).getTime()).toBeGreaterThan(
      NIGHT.getTime(),
    );
  });
});
