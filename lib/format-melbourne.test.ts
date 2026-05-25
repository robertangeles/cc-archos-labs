import { describe, expect, it } from "vitest";
import {
  formatMelbourneDateTime,
  formatMelbourneForHumans,
  formatMelbourneShort,
  melbourneParts,
  melbourneTzAbbrev,
  melbourneWallToUtcIso,
  splitMelbourneDatetime,
} from "./format-melbourne";

// Anchored to the production bug that prompted this module: a post
// scheduled for "2026-05-26 09:00 Melbourne" stored as
// 2026-05-25T23:00:00Z showed up in the admin list as "05-25 23:00Z"
// because the formatter sliced the UTC ISO string. Every test below
// fails on the old `.toISOString().slice(...)` path and passes on the
// Intl-based path.

describe("formatMelbourneDateTime — admin posts list Date column", () => {
  it("renders 23:00 UTC (AEST) as next-day 09:00 Melbourne", () => {
    // May = AEST (UTC+10). Real prod row: "Technical Debt" post.
    expect(
      formatMelbourneDateTime(new Date("2026-05-24T23:00:04.999Z")),
    ).toBe("2026-05-25 09:00");
  });

  it("renders 22:00 UTC (AEDT) as next-day 09:00 Melbourne in DST", () => {
    // November = AEDT (UTC+11). 22:00 UTC + 11 = 09:00 next day.
    expect(
      formatMelbourneDateTime(new Date("2026-11-30T22:00:00.000Z")),
    ).toBe("2026-12-01 09:00");
  });

  it("renders mid-day Melbourne as the same calendar day", () => {
    // 03:00 UTC AEST = 13:00 same day Melbourne.
    expect(
      formatMelbourneDateTime(new Date("2026-05-25T03:00:00.000Z")),
    ).toBe("2026-05-25 13:00");
  });
});

describe("formatMelbourneShort — scheduled-status chip", () => {
  it("renders the prod-bug screenshot row in Melbourne wall-time", () => {
    // Screenshot row: "scheduled · 05-25 23:00Z" for a post scheduled
    // May 26 09:00 Melbourne. Should render as "05-26 09:00" now.
    expect(
      formatMelbourneShort(new Date("2026-05-25T23:00:00.000Z")),
    ).toBe("05-26 09:00");
  });
});

describe("melbourneParts", () => {
  it("returns 2-digit zero-padded fields", () => {
    const p = melbourneParts(new Date("2026-05-24T23:00:00.000Z"));
    expect(p.year).toBe("2026");
    expect(p.month).toBe("05");
    expect(p.day).toBe("25");
    expect(p.hour).toBe("09");
    expect(p.minute).toBe("00");
  });

  it("normalises 24 → 00 at midnight Melbourne", () => {
    // 14:00 UTC AEST = 00:00 next day Melbourne. Intl en-CA emits "24"
    // for midnight; we normalise so <input type="time"> accepts it.
    const p = melbourneParts(new Date("2026-05-24T14:00:00.000Z"));
    expect(p.hour).toBe("00");
    expect(p.day).toBe("25");
  });
});

describe("splitMelbourneDatetime", () => {
  it("splits a UTC date into Melbourne date + time strings", () => {
    const r = splitMelbourneDatetime(
      new Date("2026-05-24T23:00:00.000Z"),
    );
    expect(r).toEqual({ date: "2026-05-25", time: "09:00" });
  });

  it("returns empty strings for null/undefined", () => {
    expect(splitMelbourneDatetime(null)).toEqual({ date: "", time: "" });
    expect(splitMelbourneDatetime(undefined)).toEqual({
      date: "",
      time: "",
    });
  });
});

describe("melbourneWallToUtcIso — picker save path", () => {
  it("round-trips 09:00 Melbourne (AEST) to 23:00 UTC prior day", () => {
    expect(melbourneWallToUtcIso("2026-05-26T09:00")).toBe(
      "2026-05-25T23:00:00.000Z",
    );
  });

  it("round-trips 09:00 Melbourne (AEDT) to 22:00 UTC prior day", () => {
    // December = AEDT (UTC+11).
    expect(melbourneWallToUtcIso("2026-12-01T09:00")).toBe(
      "2026-11-30T22:00:00.000Z",
    );
  });

  it("returns empty string for empty input", () => {
    expect(melbourneWallToUtcIso("")).toBe("");
  });
});

describe("formatMelbourneForHumans", () => {
  it("formats a wall string as DD/MM/YYYY HH:MM", () => {
    expect(formatMelbourneForHumans("2026-05-26T09:00")).toBe(
      "26/05/2026 09:00",
    );
  });

  it("returns the input unchanged on malformed shapes", () => {
    expect(formatMelbourneForHumans("not-a-date")).toBe("not-a-date");
    expect(formatMelbourneForHumans("")).toBe("");
  });
});

describe("melbourneTzAbbrev", () => {
  it("returns a non-empty short label", () => {
    const v = melbourneTzAbbrev();
    expect(v).toMatch(/^(AEST|AEDT|GMT\+\d+)$/);
  });
});
