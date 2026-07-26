import { describe, expect, it } from "vitest";
import { describeHealth, parseVerdict } from "./pipeline-view";

// The two pure pieces behind /admin/blog/pipeline. Both exist to stop the page
// telling a comfortable lie: a stalled agent that looks healthy, or a verdict
// panel that swallows the reason a post was parked.

const NOW = new Date("2026-07-26T04:00:00Z");
const base = {
  now: NOW,
  dueToday: true,
  postsThisWeek: 2,
  targetThisWeek: 3,
};

describe("describeHealth", () => {
  it("reports running when it checked in recently", () => {
    const h = describeHealth({
      ...base,
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    expect(h.tone).toBe("running");
    expect(h.headline).toBe("Running");
  });

  it("calls a switched-on agent that has not checked in for a day STALLED", () => {
    // The failure this catches is the cron itself not firing, which is
    // invisible from inside the app — the config still says enabled, and
    // rendering only the timestamp makes it look identical to healthy.
    const h = describeHealth({
      ...base,
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 26 * 60 * 60 * 1000),
    });
    expect(h.tone).toBe("stalled");
    expect(h.headline).toBe("Not running");
    expect(h.detail).toContain("scheduled job");
  });

  it("is still running at 24 hours and stalled at 26", () => {
    const at = (hours: number) =>
      describeHealth({
        ...base,
        enabled: true,
        lastRunAt: new Date(NOW.getTime() - hours * 60 * 60 * 1000),
      }).tone;
    expect(at(24)).toBe("running");
    expect(at(26)).toBe("stalled");
  });

  it("reports stopped before anything else, even when stale", () => {
    // A stopped agent has not run because you stopped it. Calling that
    // "stalled" would send someone to check a cron that is fine.
    const h = describeHealth({
      ...base,
      enabled: false,
      lastRunAt: new Date("2020-01-01T00:00:00Z"),
    });
    expect(h.tone).toBe("stopped");
  });

  it("reports stopped even when it has never run", () => {
    expect(describeHealth({ ...base, enabled: false, lastRunAt: null }).tone).toBe(
      "stopped",
    );
  });

  it("distinguishes never-run from stalled", () => {
    // Both point at the scheduled job, but "has not run once" and "stopped
    // checking in" send you to different places, so the copy must differ.
    const never = describeHealth({ ...base, enabled: true, lastRunAt: null });
    const stalled = describeHealth({
      ...base,
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
    });
    expect(never.tone).toBe("never-run");
    expect(stalled.tone).toBe("stalled");
    expect(never.detail).not.toBe(stalled.detail);
    expect(never.detail).toMatch(/scheduled job/);
  });

  it("carries the week's count and target through untouched", () => {
    const h = describeHealth({
      ...base,
      enabled: true,
      lastRunAt: NOW,
      postsThisWeek: 5,
      targetThisWeek: 7,
    });
    expect(h.postsThisWeek).toBe(5);
    expect(h.targetThisWeek).toBe(7);
  });

  it("says something different on a non-publishing day", () => {
    const on = describeHealth({ ...base, enabled: true, lastRunAt: NOW, dueToday: true });
    const off = describeHealth({ ...base, enabled: true, lastRunAt: NOW, dueToday: false });
    expect(on.detail).not.toBe(off.detail);
    expect(off.detail).toContain("not scheduled to write today");
  });
});

describe("parseVerdict", () => {
  const verdict = {
    rounds: [
      {
        round: 0,
        gate: [
          { tell: "fabricated-experience", severity: "hard", quote: "I spent three months.", note: "No experience to draw on." },
          { tell: "absolutist-adverb", severity: "soft", quote: "always", note: "Density is high." },
        ],
        judge: {
          verdict: "reject",
          findings: [{ tell: "ungrounded-claim", quote: "Eighty percent fail.", why: "Not in the research." }],
        },
      },
      { round: 1, gate: [], judge: { verdict: "pass", findings: [] } },
    ],
  };

  it("returns one entry per round, including the one that passed", () => {
    // The passing round is what shows a rewrite happened and worked.
    const rounds = parseVerdict(verdict);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].findings).toHaveLength(0);
  });

  it("keeps hard gate failures and drops soft signals", () => {
    // A soft signal is tuning information, not the reason a post was parked.
    const tells = parseVerdict(verdict)[0].findings.map((f) => f.tell);
    expect(tells).toContain("fabricated-experience");
    expect(tells).not.toContain("absolutist-adverb");
  });

  it("keeps judge findings alongside gate findings", () => {
    expect(parseVerdict(verdict)[0].findings.map((f) => f.tell)).toContain(
      "ungrounded-claim",
    );
  });

  it("reads the reason from note for gate findings and why for judge findings", () => {
    const findings = parseVerdict(verdict)[0].findings;
    expect(findings.find((f) => f.tell === "fabricated-experience")?.why).toBe(
      "No experience to draw on.",
    );
    expect(findings.find((f) => f.tell === "ungrounded-claim")?.why).toBe(
      "Not in the research.",
    );
  });

  it("discards a finding with no quote", () => {
    // The whole point of the panel is showing the offending sentence. A
    // finding that cannot be quoted is an assertion, not evidence.
    const rounds = parseVerdict({
      rounds: [{ round: 0, gate: [], judge: { findings: [{ tell: "x", why: "y" }] } }],
    });
    expect(rounds[0].findings).toHaveLength(0);
  });

  it("returns an empty list rather than throwing on anything unexpected", () => {
    // A verdict written by an older shape must not take the page down.
    for (const bad of [null, undefined, 0, "x", [], {}, { rounds: "nope" }, { rounds: [null, 7] }]) {
      expect(() => parseVerdict(bad)).not.toThrow();
      expect(Array.isArray(parseVerdict(bad))).toBe(true);
    }
  });
});
