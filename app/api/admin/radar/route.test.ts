import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/admin/radar: parameter validation and the error shape. The data
// itself is covered against real Postgres in lib/news-radar/queries.test.ts.

const loadRadarPage = vi.fn();
const loadRadarSummary = vi.fn();
vi.mock("../../../../lib/news-radar/queries", () => ({
  loadRadarPage: (...a: unknown[]) => loadRadarPage(...a),
  loadRadarSummary: (...a: unknown[]) => loadRadarSummary(...a),
}));
const DB = { fake: true };
vi.mock("../../../../lib/db", () => ({ getDb: () => DB }));

const { GET } = await import("./route");

const get = (qs = "") => GET(new Request(`http://localhost/api/admin/radar${qs}`));

beforeEach(() => {
  loadRadarPage.mockReset().mockResolvedValue({ view: "to-label", days: [] });
  loadRadarSummary.mockReset().mockResolvedValue({ newCount: 3 });
});

describe("GET /api/admin/radar", () => {
  it("defaults to the to-label view", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: "to-label", days: [] });
    expect(loadRadarPage).toHaveBeenCalledWith(DB, {
      view: "to-label",
      cohort: undefined,
      page: undefined,
    });
  });

  it("passes view, cohort and page as numbers", async () => {
    await get("?view=all&cohort=3&page=2");
    expect(loadRadarPage).toHaveBeenCalledWith(DB, { view: "all", cohort: 3, page: 2 });
  });

  it.each([
    "?view=nope",
    "?view=",
    "?cohort=0",
    "?cohort=-1",
    "?cohort=1.5",
    "?cohort=abc",
    "?cohort=",
    "?cohort=99999999999",
    "?page=0",
    "?page=x",
    "?summary=2&since=2026-10-26T00:00:00Z",
    "?summary=1",
    "?summary=1&since=",
    "?summary=1&since=yesterday",
    "?summary=1&since=2026-10-26",
    "?summary=1&since=2026-13-45T00:00:00Z",
  ])("rejects %s with 400 and reads nothing", async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(loadRadarPage).not.toHaveBeenCalled();
    expect(loadRadarSummary).not.toHaveBeenCalled();
  });

  it("answers summary=1 with the summary, not the page", async () => {
    const res = await get("?summary=1&since=2026-10-26T01:02:03.456Z");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newCount: 3 });
    expect(loadRadarSummary).toHaveBeenCalledWith(DB, new Date("2026-10-26T01:02:03.456Z"));
    expect(loadRadarPage).not.toHaveBeenCalled();
  });

  it("accepts an offset in since", async () => {
    await get("?summary=1&since=2026-10-26T12:00:00%2B11:00");
    expect(loadRadarSummary).toHaveBeenCalledWith(DB, new Date("2026-10-26T01:00:00Z"));
  });

  it("returns a plain 500 without the exception text", async () => {
    const secret = "connection to 10.0.0.5 refused (password=hunter2)";
    loadRadarPage.mockRejectedValue(new Error(secret));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get("?view=kept");
      const text = await res.text();
      expect(res.status).toBe(500);
      expect(JSON.parse(text)).toEqual({ ok: false, error: "Couldn't load the radar." });
      expect(text).not.toContain("hunter2");
      // Only the error NAME is logged, never its message.
      expect(JSON.stringify(err.mock.calls)).not.toContain("hunter2");
      expect(err).toHaveBeenCalledTimes(1);
    } finally {
      err.mockRestore();
    }
  });

  it("returns the same 500 when the summary fails", async () => {
    loadRadarSummary.mockRejectedValue(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get("?summary=1&since=2026-10-26T00:00:00Z");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ ok: false, error: "Couldn't load the radar." });
    } finally {
      err.mockRestore();
    }
  });
});
