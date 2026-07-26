import { describe, expect, it } from "vitest";
import { isDueToday, postsPerWeek } from "./config";
import { BLOG_AGENT_CONFIG_STARTER } from "./config-shared";

// The velocity ramp is the answer to Google naming publishing velocity
// measured against a site's own history as a scaled-content signal. This blog
// has 254 migrated posts and near-zero recent publishing, so 0 to 7/week
// overnight is exactly the spike that signal looks for.
//
// Both functions are pure and take `now`, so none of this depends on a clock.

function cfg(over: Partial<typeof BLOG_AGENT_CONFIG_STARTER["velocity"]> = {}) {
  return {
    ...BLOG_AGENT_CONFIG_STARTER,
    velocity: { startDate: "2026-01-05", weeklyRamp: [2, 3, 5, 7], ...over },
  };
}

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("postsPerWeek", () => {
  it("uses the first rung in week 0", () => {
    expect(postsPerWeek(cfg(), d("2026-01-05"))).toBe(2);
    expect(postsPerWeek(cfg(), d("2026-01-11"))).toBe(2);
  });

  it("steps up a rung per elapsed week", () => {
    expect(postsPerWeek(cfg(), d("2026-01-12"))).toBe(3);
    expect(postsPerWeek(cfg(), d("2026-01-19"))).toBe(5);
    expect(postsPerWeek(cfg(), d("2026-01-26"))).toBe(7);
  });

  it("holds at the last rung forever after", () => {
    expect(postsPerWeek(cfg(), d("2027-06-01"))).toBe(7);
  });

  it("returns 0 before the start date so an early cron does nothing", () => {
    expect(postsPerWeek(cfg(), d("2025-12-01"))).toBe(0);
  });

  it("falls back to the first rung on an unparseable start date", () => {
    expect(postsPerWeek(cfg({ startDate: "not-a-date" }), d("2026-06-01"))).toBe(2);
  });
});

describe("isDueToday", () => {
  it("spreads 2/week across the week rather than bunching them", () => {
    // Days 0 and 3 of 7, not two days running.
    const week = [
      "2026-01-04", // Sun (day 0)
      "2026-01-05", // Mon
      "2026-01-06", // Tue
      "2026-01-07", // Wed (day 3)
      "2026-01-08", // Thu
      "2026-01-09", // Fri
      "2026-01-10", // Sat
    ];
    const due = week.filter((day) =>
      isDueToday(cfg({ startDate: "2026-01-04" }), d(day)),
    );
    expect(due).toEqual(["2026-01-04", "2026-01-07"]);
  });

  it("is due every day once the ramp reaches 7", () => {
    const c = cfg({ startDate: "2026-01-04", weeklyRamp: [7] });
    for (let i = 0; i < 7; i++) {
      const day = new Date(Date.UTC(2026, 0, 4 + i, 12));
      expect(isDueToday(c, day), day.toISOString()).toBe(true);
    }
  });

  it("is never due before the start date", () => {
    expect(isDueToday(cfg(), d("2025-12-25"))).toBe(false);
  });

  it("is never due when the ramp is 0", () => {
    expect(isDueToday(cfg({ weeklyRamp: [0] }), d("2026-06-01"))).toBe(false);
  });

  it("is deterministic — the same date always gives the same answer", () => {
    // Matters because a retried cron tick must not be able to sneak an extra
    // post through by asking again.
    const c = cfg({ startDate: "2026-01-04" });
    const day = d("2026-01-07");
    const answers = Array.from({ length: 5 }, () => isDueToday(c, day));
    expect(new Set(answers).size).toBe(1);
  });
});

describe("shipped defaults", () => {
  it("ships disabled so nothing can publish before it is configured", () => {
    expect(BLOG_AGENT_CONFIG_STARTER.enabled).toBe(false);
  });

  it("ships with a placeholder field map that preflight will reject", () => {
    expect(BLOG_AGENT_CONFIG_STARTER.fieldMap.topic).toMatch(/REPLACE_WITH/);
  });

  it("maps every founder-facing category onto a real slug", () => {
    expect(Object.keys(BLOG_AGENT_CONFIG_STARTER.categoryMap)).toEqual([
      "Data Foundations",
      "AI Readiness",
      "Build Without a Team",
      "Getting to ROI",
    ]);
    for (const slug of Object.values(BLOG_AGENT_CONFIG_STARTER.categoryMap)) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
