import { describe, expect, it } from "vitest";
import {
  COPY,
  draftLine,
  formatClock,
  formatDayHeader,
  formatRowTime,
  statusLines,
  truncateTitle,
} from "./radar-copy";
import type { RadarDraft, RadarProgress, RadarStatus } from "../../../lib/news-radar/radar-page-types";

// The exact words of the Radar page (plan DES-D8) and the Melbourne time
// formatting. Strings are asserted verbatim: a copy change should be a
// deliberate edit to this file.

describe("copy table", () => {
  it("has the state copy verbatim", () => {
    expect(COPY.nothingYet("16:00 AEDT")).toBe("Nothing to label yet. Next check 16:00 AEDT.");
    expect(COPY.doneToday(8, 8, "16:00 AEDT")).toBe("Done for today. 8 of 8 labelled. Next check 16:00 AEDT.");
    expect(COPY.emptyView.kept).toBe("Nothing kept yet.");
    expect(COPY.emptyView.skipped).toBe("Nothing skipped yet.");
    expect(COPY.emptyView.shortlisted).toBe("No shortlisted items in this cohort yet.");
    expect(COPY.emptyView.all).toBe("No items yet.");
    expect(COPY.gateReady(52, 7)).toBe("Gate ready: 52 labelled over 7 days. Run the gate report.");
    expect(COPY.noKey).toBe("Jev is not connected. Add the TypeSafe key in Integrations to start scoring.");
    expect(COPY.openIntegrations).toBe("Open Integrations");
    expect(COPY.loadError).toBe("Couldn't load the radar.");
    expect(COPY.retry).toBe("Retry");
    expect(COPY.notScored).toBe("Not scored yet");
    expect(COPY.saveFailed).toBe("Couldn't save. Retry");
    expect(COPY.hint).toBe("Keep: I'd write about this. Skip: I wouldn't. Leave blank to decide later.");
    expect(COPY.labelInToLabel).toBe("Label in To label");
  });

  it("builds the conflict note and the undo line", () => {
    expect(COPY.conflict("skip", "keep")).toBe("Changed in another tab. Now: Skipped. Use mine (Keep)");
    expect(COPY.conflict(null, "skip")).toBe("Changed in another tab. Now: Not labelled. Use mine (Skip)");
    expect(COPY.conflict("keep", "clear")).toBe("Changed in another tab. Now: Kept. Use mine (Clear)");
    expect(COPY.undo("keep", "Nvidia H200 GPU rental rates rise sharply as demand grows")).toBe(
      "Kept 'Nvidia H200 GPU rental rates rise...'. Undo",
    );
    expect(COPY.undo("skip", "Short")).toBe("Skipped 'Short'. Undo");
    expect(COPY.undo("clear", "Short")).toBe("Cleared 'Short'. Undo");
  });

  it("truncates a long title on a word-safe boundary with an ellipsis, leaving short ones alone", () => {
    expect(truncateTitle("Short")).toBe("Short");
    expect(truncateTitle("a".repeat(60))).toBe(`${"a".repeat(36)}...`);
  });

  it("never uses an em dash or an exclamation mark", () => {
    const text = JSON.stringify(COPY) + COPY.nothingYet("x") + COPY.conflict("keep", "skip");
    expect(text).not.toMatch(/[—!]/);
  });
});

describe("Melbourne time formatting", () => {
  it("formats a clock time in Melbourne, across both DST offsets", () => {
    expect(formatClock("2026-10-26T03:00:00Z")).toBe("14:00"); // AEDT, UTC+11
    expect(formatClock("2026-07-01T03:00:00Z")).toBe("13:00"); // AEST, UTC+10
  });

  it("formats a row time as weekday and clock, and a day header as weekday, date and month", () => {
    expect(formatRowTime("2026-10-26T03:20:00Z")).toBe("Mon 14:20");
    expect(formatDayHeader("2026-10-26")).toBe("Mon 26 Oct");
    expect(formatDayHeader("2026-01-05")).toBe("Mon 5 Jan");
  });
});

const progress = (over: Partial<RadarProgress> = {}): RadarProgress => ({
  todayLabelled: 3, todayTotal: 8, cohortLabelled: 31, cohortTarget: 50, validDays: 4, targetDays: 7, gateReady: false, ...over,
});
const status = (over: Partial<RadarStatus> = {}): RadarStatus => ({
  state: "healthy", lastCheckAt: "2026-10-26T03:00:00Z", failureClass: null, failedSlotAt: null,
  nextCheckAt: "2026-10-26T05:00:00Z", ...over,
});

describe("status lines", () => {
  const tz = "AEDT";

  it("level one is progress, level two a quiet health line with the zone once", () => {
    const s = statusLines(progress(), status(), 7, tz);
    expect(s.today).toBe("Today 3 of 8 labelled");
    expect(s.cohort).toBe("Cohort v7: 31 of 50 labelled · day 4 of 7");
    expect(s.health).toBe("Healthy · updated 14:00 · next check 16:00 AEDT");
    expect(s.tone).toBe("ok");
  });

  it("reports a stale radar with the last good time", () => {
    const s = statusLines(progress(), status({ state: "stale", lastCheckAt: "2026-10-25T23:00:00Z" }), 7, tz);
    expect(s.health).toBe("Stale: no successful check since 10:00 AEDT. Next check 16:00.");
    expect(s.tone).toBe("warn");
  });

  it("reports a stale radar that never ran", () => {
    const s = statusLines(progress(), status({ state: "stale", lastCheckAt: null }), 7, tz);
    expect(s.health).toBe("Stale: no successful check yet. Next check 16:00 AEDT.");
  });

  it("names a failing check in plain words, not an error class", () => {
    const jev = statusLines(progress(), status({ state: "failing", failureClass: "JevAuthError", failedSlotAt: "2026-10-26T03:00:00Z" }), 7, tz);
    expect(jev.health).toBe("Failing: the 14:00 check failed (Jev unavailable). Next check 16:00.");
    expect(jev.tone).toBe("bad");
    const feed = statusLines(progress(), status({ state: "failing", failureClass: "FeedFetchError", failedSlotAt: "2026-10-26T03:00:00Z" }), 7, tz);
    expect(feed.health).toContain("(news feed unreachable)");
    const other = statusLines(progress(), status({ state: "failing", failureClass: "Whatever", failedSlotAt: "2026-10-26T03:00:00Z" }), 7, tz);
    expect(other.health).toContain("(see the runbook)");
  });

  it("says the radar is off or has no key", () => {
    expect(statusLines(progress(), status({ state: "off" }), 7, tz).health).toBe("Radar is off. Set the news_radar_enabled setting to start it.");
    expect(statusLines(progress(), status({ state: "no-key" }), 7, tz).health).toBe(COPY.noKey);
  });

  it("shows the gate-ready line instead of progress when the gate holds", () => {
    const s = statusLines(progress({ gateReady: true, cohortLabelled: 52, validDays: 7 }), status(), 7, tz);
    expect(s.cohort).toBe("Gate ready: 52 labelled over 7 days. Run the gate report.");
  });

  it("has no cohort text before any rubric exists", () => {
    expect(statusLines(progress(), status(), null, tz).cohort).toBe("");
  });
});

describe("draftLine", () => {
  const d = (status: RadarDraft["status"], over: Partial<RadarDraft> = {}): RadarDraft => ({
    status, postId: null, postStatus: null, publishAt: null, reason: null, ...over,
  });

  it("says queued and running plainly, with nothing to open yet", () => {
    expect(draftLine(d("queued"), "AEDT")).toEqual({ text: "Draft queued", tone: "muted" });
    expect(draftLine(d("running"), "AEDT")).toEqual({ text: "Drafting now", tone: "muted" });
  });

  it("tells Rob to review a scheduled draft before it is due, in Melbourne time, and links the post", () => {
    // 2026-10-27 13:00Z is Wed 00:00 in Melbourne (AEDT, UTC+11)
    const line = draftLine(d("succeeded", { postId: "p1", postStatus: "scheduled", publishAt: "2026-10-27T13:00:00Z" }), "AEDT");
    expect(line).toEqual({
      text: "Draft ready. Review it before Wed 00:00 AEDT",
      tone: "ok",
      link: { href: "/admin/blog/posts/p1", label: "Review draft" },
    });
  });

  it("says Published for a live post, and Draft ready for any other state of the post", () => {
    expect(draftLine(d("succeeded", { postId: "p1", postStatus: "published", publishAt: "2026-10-27T13:00:00Z" }), "AEDT")).toMatchObject({ text: "Published", link: { label: "Open post" } });
    expect(draftLine(d("succeeded", { postId: "p1", postStatus: "draft" }), "AEDT")).toMatchObject({ text: "Draft ready", link: { href: "/admin/blog/posts/p1" } });
  });

  it("says so when the post was deleted, with no dead link", () => {
    expect(draftLine(d("succeeded"), "AEDT")).toEqual({ text: "Draft was deleted", tone: "muted" });
  });

  it("explains what needs Rob in words, never a code", () => {
    expect(draftLine(d("needs_attention", { reason: "no_primary_source" }), "AEDT")).toEqual({ text: "Needs you: no primary source found", tone: "warn" });
    expect(draftLine(d("needs_attention", { reason: "unverified_quotes" }), "AEDT").text).toBe("Needs you: the research quoted words the sources do not say");
    expect(draftLine(d("failed", { reason: "crashed" }), "AEDT")).toEqual({ text: "Drafting failed: drafting crashed", tone: "bad" });
  });

  it("does not show an unknown or missing reason code", () => {
    expect(draftLine(d("needs_attention", { reason: "something_new" }), "AEDT").text).toBe("Needs you: see the job");
    expect(draftLine(d("failed"), "AEDT").text).toBe("Drafting failed: see the job");
  });

  it("every reason the pipeline can produce has words", () => {
    const reasons = ["no_sources_found", "sources_unreachable", "no_primary_source", "unverified_quotes", "failed_gates", "slop_verdict", "judge_failed", "model_error", "missing_setup", "lease_expired", "crashed"];
    for (const reason of reasons) expect(draftLine(d("needs_attention", { reason }), "AEDT").text).not.toContain("see the job");
  });
});
