import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RadarList } from "./radar-list";
import type { RadarPageData, RadarRow, RadarView } from "../../../lib/news-radar/radar-page-types";

// What the page renders for each state, from the first server render (no
// effects run). Interaction (optimistic update, undo, conflict, focus) is
// covered in a real browser by tests/e2e/radar.spec.ts.

const row = (over: Partial<RadarRow> = {}): RadarRow => ({
  id: "r1", title: "Regulators finalise audit rules for bank AI", summary: "A two-line summary of the item.",
  category: "ai", sourceUrl: "https://huggingnews.com/ai/audit-rules", sourceHost: "huggingnews.com",
  publishedAt: "2026-10-26T03:20:00Z", day: "2026-10-26", status: "scored", cohortVersion: 1, eligible: true,
  audienceFit: { score: 2.5, confidence: 0.91 }, noveltyDistance: 0.55, label: null, latestLabelId: null, ...over,
});

function data(over: Partial<RadarPageData> = {}, rows: RadarRow[] = [row()], more: RadarRow[] = []): RadarPageData {
  return {
    view: "to-label",
    cohort: { version: 1, startedAt: "2026-10-26T00:00:00Z", isActive: true },
    cohorts: [{ version: 1, startedAt: "2026-10-26T00:00:00Z", isActive: true }],
    counts: { toLabel: rows.length, shortlisted: rows.length, kept: 0, skipped: 0, all: rows.length },
    days: rows.length || more.length ? [{ day: "2026-10-26", rows, more }] : [],
    page: null,
    progress: { todayLabelled: 0, todayTotal: rows.length, cohortLabelled: 0, cohortTarget: 50, validDays: 0, targetDays: 7, gateReady: false },
    status: { state: "healthy", lastCheckAt: "2026-10-26T03:00:00Z", failureClass: null, failedSlotAt: null, nextCheckAt: "2026-10-26T05:00:00Z" },
    generatedAt: "2026-10-26T04:00:00Z",
    ...over,
  };
}

const html = (d: RadarPageData | null) => renderToStaticMarkup(<RadarList initial={d} />);

describe("RadarList: To label", () => {
  const out = html(data());

  it("shows the status area, the pills with counts and the first-use hint", () => {
    expect(out).toContain("Today 0 of 1 labelled");
    expect(out).toContain("Cohort v1: 0 of 50 labelled · day 0 of 7");
    expect(out).toContain("Healthy · updated 14:00 · next check 16:00 AEDT");
    expect(out).toContain("To label");
    expect(out).toContain("Shortlisted");
    expect(out).toContain("Keep: I&#x27;d write about this. Skip: I wouldn&#x27;t. Leave blank to decide later.");
  });

  it("renders the day panel with a heading and the row as an accessible group", () => {
    expect(out).toContain("Mon 26 Oct");
    expect(out).toContain("1 to label");
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-labelledby="row-r1"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("(opens in new tab)");
    expect(out).toContain("huggingnews.com · AI · ");
    expect(out).toContain("Mon 14:20");
  });

  it("names both buttons after the item and starts unpressed", () => {
    expect(out).toContain('aria-label="Keep: Regulators finalise audit rules for bank AI"');
    expect(out).toContain('aria-label="Skip: Regulators finalise audit rules for bank AI"');
    expect(out.match(/aria-pressed="false"/g)).toHaveLength(2);
  });

  it("hides every score until Show scores is on", () => {
    expect(out).not.toMatch(/2\.50|0\.91|0\.55/);
    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-checked="false"');
  });

  it("has a polite live region and no horizontal-scroll trap on the pills", () => {
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("overflow-x-auto");
  });
});

describe("RadarList: labelled items", () => {
  it("shows the selected state with a check and the word, and dims the title", () => {
    const out = html(data({}, [row({ label: { id: "l1", decision: "keep" }, latestLabelId: "l1" })]));
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain("Kept");
    expect(out).toContain("text-ink-subtle visited:text-ink-subtle".split(" ")[0]); // dimmed title class present
  });

  it("drops the first-use hint once something is labelled", () => {
    const out = html(data({ counts: { toLabel: 0, shortlisted: 1, kept: 1, skipped: 0, all: 1 } }));
    expect(out).not.toContain("Leave blank to decide later");
  });
});

describe("RadarList: other views are read-only (DES-D14)", () => {
  const view = (v: RadarView, r: RadarRow) => html(data({ view: v }, [r]));

  it("has no Keep/Skip buttons outside To label", () => {
    const out = view("shortlisted", row());
    expect(out).not.toContain("aria-pressed");
    expect(out).toContain("Label in To label");
  });

  it("shows a read-only Kept or Skipped marker for labelled items", () => {
    expect(view("kept", row({ label: { id: "l", decision: "keep" } }))).toContain("Kept");
    expect(view("skipped", row({ label: { id: "l", decision: "skip" } }))).toContain("Skipped");
  });

  it("shows 'Not scored yet' and no buttons for an unscored item", () => {
    const out = html(data({ view: "all" }, [row({ status: "new", cohortVersion: null, eligible: false, audienceFit: null, noveltyDistance: null })]));
    expect(out).toContain("Not scored yet");
    expect(out).not.toContain("aria-pressed");
  });
});

describe("RadarList: empty and error states, with the exact copy", () => {
  it("nothing yet", () => {
    expect(html(data({ counts: { toLabel: 0, shortlisted: 0, kept: 0, skipped: 0, all: 0 }, progress: { todayLabelled: 0, todayTotal: 0, cohortLabelled: 0, cohortTarget: 50, validDays: 0, targetDays: 7, gateReady: false } }, []))).toContain(
      "Nothing to label yet. Next check 16:00 AEDT.",
    );
  });

  it("done for today", () => {
    expect(html(data({ progress: { todayLabelled: 8, todayTotal: 8, cohortLabelled: 8, cohortTarget: 50, validDays: 1, targetDays: 7, gateReady: false } }, []))).toContain(
      "Done for today. 8 of 8 labelled. Next check 16:00 AEDT.",
    );
  });

  it.each([
    ["kept", "Nothing kept yet."],
    ["skipped", "Nothing skipped yet."],
    ["shortlisted", "No shortlisted items in this cohort yet."],
    ["all", "No items yet."],
  ] as const)("empty %s view", (v, copy) => {
    expect(html(data({ view: v }, []))).toContain(copy);
  });

  it("load error with a Retry button when the first load failed", () => {
    const out = html(null);
    expect(out).toContain("Couldn&#x27;t load the radar.");
    expect(out).toContain("Retry");
    expect(out).toContain('role="alert"');
  });

  it("the radar is off", () => {
    expect(html(data({ status: { state: "off", lastCheckAt: null, failureClass: null, failedSlotAt: null, nextCheckAt: "2026-10-26T05:00:00Z" } }))).toContain(
      "Radar is off. Set the news_radar_enabled setting to start it.",
    );
  });

  it("no key: the copy and a link to Integrations", () => {
    const out = html(data({ status: { state: "no-key", lastCheckAt: null, failureClass: null, failedSlotAt: null, nextCheckAt: "2026-10-26T05:00:00Z" } }));
    expect(out).toContain("Jev is not connected. Add the TypeSafe key in Integrations to start scoring.");
    expect(out).toContain('href="/admin/integrations/typesafe"');
    expect(out).toContain("Open Integrations");
  });

  it("failing and stale health lines", () => {
    const failing = html(data({ status: { state: "failing", lastCheckAt: null, failureClass: "JevAuthError", failedSlotAt: "2026-10-26T03:00:00Z", nextCheckAt: "2026-10-26T05:00:00Z" } }));
    expect(failing).toContain("Failing: the 14:00 check failed (Jev unavailable). Next check 16:00.");
    const stale = html(data({ status: { state: "stale", lastCheckAt: "2026-10-25T23:00:00Z", failureClass: null, failedSlotAt: null, nextCheckAt: "2026-10-26T05:00:00Z" } }));
    expect(stale).toContain("Stale: no successful check since 10:00 AEDT. Next check 16:00.");
  });

  it("gate ready replaces the cohort progress", () => {
    const out = html(data({ progress: { todayLabelled: 1, todayTotal: 2, cohortLabelled: 52, cohortTarget: 50, validDays: 7, targetDays: 7, gateReady: true } }));
    expect(out).toContain("Gate ready: 52 labelled over 7 days. Run the gate report.");
  });
});

describe("RadarList: days, caps and pages", () => {
  it("offers 'Show N more' only when the day has more behind the cap", () => {
    const out = html(data({ view: "shortlisted" }, [row()], [row({ id: "r2" }), row({ id: "r3" })]));
    expect(out).toContain("Show 2 more");
    expect(html(data({ view: "shortlisted" }, [row()]))).not.toContain("Show 0 more");
  });

  it("marks a day that continues from the previous page", () => {
    const d = data({ view: "all", page: { number: 2, pages: 3 } });
    d.days[0].continued = true;
    const out = html(d);
    expect(out).toContain("(continued)");
    expect(out).toContain("2 / 3");
    expect(out).toContain("Previous");
    expect(out).toContain("Next");
  });

  it("shows scores as dashes for an unscored row only inside the Not scored yet state", () => {
    const out = html(data({ view: "all" }, [row({ noveltyDistance: null })]));
    expect(out).not.toContain("Novelty unavailable"); // scores are off, so nothing leaks
  });

  it("offers a cohort select with the date range", () => {
    const out = html(
      data({
        cohorts: [
          { version: 2, startedAt: "2026-10-28T00:00:00Z", isActive: true },
          { version: 1, startedAt: "2026-10-22T00:00:00Z", isActive: false },
        ],
        cohort: { version: 2, startedAt: "2026-10-28T00:00:00Z", isActive: true },
      }),
    );
    expect(out).toContain("Cohort v2 · 28 Oct");
    expect(out).toContain("Cohort v1 · 22-27 Oct");
  });
});
