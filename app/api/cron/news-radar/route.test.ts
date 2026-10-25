import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// POST /api/cron/news-radar: auth, slot, delegate, heartbeat. The tick itself is
// tested in lib/news-radar/radar.test.ts; here runTick and the heartbeat are fakes.

const runTick = vi.fn();
const touchHeartbeat = vi.fn();
vi.mock("../../../../lib/news-radar/radar", () => ({
  runTick: (...a: unknown[]) => runTick(...a),
}));
vi.mock("../../../../lib/cron-heartbeat", () => ({
  touchHeartbeat: (...a: unknown[]) => touchHeartbeat(...a),
}));

const { POST } = await import("./route");

const SECRET = "a-long-enough-cron-secret-123";

const result = (over: Record<string, unknown> = {}) => ({
  outcome: "ok", fetched: 20, newCount: 5, scored: 4, unscored: 1, failedCount: 0,
  errorClass: null, rubricVersion: 3, ...over,
});

const call = (headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) =>
  POST(new NextRequest("http://localhost/api/cron/news-radar", { method: "POST", headers }));

beforeEach(() => {
  runTick.mockReset().mockResolvedValue(result());
  touchHeartbeat.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/cron/news-radar", () => {
  it("503 without CRON_SECRET and does no work", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call();
    expect(res.status).toBe(503);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("503 when CRON_SECRET is too short to be a secret", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call({ authorization: "Bearer short" })).status).toBe(503);
  });

  it("401 for a wrong secret and for no header, with no work done", async () => {
    expect((await call({ authorization: "Bearer wrong-wrong-wrong-wrong" })).status).toBe(401);
    expect((await call({})).status).toBe(401);
    expect((await call({ authorization: SECRET })).status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
    expect(touchHeartbeat).not.toHaveBeenCalled();
  });

  it("200 and dormant when the radar is disabled, still recording the heartbeat", async () => {
    runTick.mockResolvedValue(result({ outcome: "disabled", fetched: 0, newCount: 0, scored: 0, unscored: 0, rubricVersion: null }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, dormant: true, outcome: "disabled" });
    expect(touchHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("200 on the happy path with counts, the 2-hour UTC slot and the heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T05:37:12Z"));
    const res = await call();
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true, dormant: false, outcome: "ok", slotAt: "2026-10-26T04:00:00.000Z",
      fetched: 20, newCount: 5, scored: 4, unscored: 1, rubricVersion: 3,
    });
    expect(runTick).toHaveBeenCalledWith(new Date("2026-10-26T04:00:00Z"));
    expect(touchHeartbeat).toHaveBeenCalledWith(
      "news-radar",
      expect.objectContaining({ processed: 4, failed: 1 }),
    );
  });

  it("503 when the tick failed, naming only the error class", async () => {
    runTick.mockResolvedValue(result({ outcome: "failed", errorClass: "JevAuthError", scored: 0 }));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, errorClass: "JevAuthError" });
  });

  it("503 with a plain message and NO heartbeat when the tick crashes", async () => {
    runTick.mockRejectedValue(new Error("secret title leaked here"));
    const res = await call();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("Tick crashed.");
    expect(text).not.toContain("secret title");
    expect(touchHeartbeat).not.toHaveBeenCalled();
  });
});
