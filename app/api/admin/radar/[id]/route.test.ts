import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH /api/admin/radar/[id] is a thin wrapper: validate, call applyLabel, map
// the result. The label rules themselves are proven in lib/news-radar/labels.test.ts.
// Admin gating is proxy.ts's job for every /api/admin/** path, so it is not here.

const applyLabel = vi.fn();
const DB = { fake: "db" };
vi.mock("../../../../../lib/news-radar/labels", () => ({
  applyLabel: (...a: unknown[]) => applyLabel(...a),
}));
vi.mock("../../../../../lib/db", () => ({ getDb: () => DB }));

const { PATCH } = await import("./route");

const ITEM = randomUUID();
const REQUEST = randomUUID();
const LABEL = { id: randomUUID(), decision: "keep" as const };

function patch(body: unknown, id: string = ITEM, raw?: string) {
  return PATCH(
    new Request(`http://localhost/api/admin/radar/${id}`, {
      method: "PATCH",
      headers: { origin: "http://localhost" },
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  applyLabel.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost");
});

describe("PATCH /api/admin/radar/[id] same-origin guard", () => {
  const body = JSON.stringify({ decision: "keep", requestId: REQUEST });
  const call = (headers: Record<string, string>) =>
    PATCH(new Request(`http://localhost/api/admin/radar/${ITEM}`, { method: "PATCH", headers, body }), {
      params: Promise.resolve({ id: ITEM }),
    });

  it("403s a foreign Origin and does no work", async () => {
    const res = await call({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "Forbidden." });
    expect(applyLabel).not.toHaveBeenCalled();
  });

  it("403s a request with neither Origin nor Referer", async () => {
    expect((await call({})).status).toBe(403);
    expect(applyLabel).not.toHaveBeenCalled();
  });

  it("accepts the site's own Referer when Origin is absent", async () => {
    applyLabel.mockResolvedValue({ kind: "ok", label: null, latestLabelId: null, changed: false });
    expect((await call({ referer: "http://localhost/admin/blog/radar" })).status).toBe(200);
  });
});

describe("PATCH /api/admin/radar/[id] results", () => {
  it("passes the id and the parsed body to applyLabel and answers 200 with the label", async () => {
    applyLabel.mockResolvedValue({ kind: "ok", label: LABEL, latestLabelId: LABEL.id, changed: true });
    const body = { decision: "keep", requestId: REQUEST, ifLatestLabelId: null };

    const res = await patch(body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, label: LABEL, latestLabelId: LABEL.id, changed: true });
    expect(applyLabel).toHaveBeenCalledWith(DB, ITEM, body);
  });

  it("returns latestLabelId of a clear row while the label is null", async () => {
    const clearId = randomUUID();
    applyLabel.mockResolvedValue({ kind: "ok", label: null, latestLabelId: clearId, changed: true });

    const res = await patch({ decision: "clear", requestId: REQUEST });

    expect(await res.json()).toEqual({ ok: true, label: null, latestLabelId: clearId, changed: true });
  });

  it("answers 409 with the current label and newest id on a conflict", async () => {
    const newest = randomUUID();
    applyLabel.mockResolvedValue({ kind: "conflict", current: LABEL, latestLabelId: newest });

    const res = await patch({ decision: "skip", requestId: REQUEST, ifLatestLabelId: randomUUID() });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "conflict", current: LABEL, latestLabelId: newest });
  });

  it.each([
    [{ kind: "not-found" }, 404, "Item not found."],
    [{ kind: "not-scored" }, 422, "This item has not been scored yet."],
    [{ kind: "request-id-reused" }, 422, "That request id was already used for a different change."],
  ])("maps %j to %i", async (result, status, error) => {
    applyLabel.mockResolvedValue(result);

    const res = await patch({ decision: "keep", requestId: REQUEST });

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error });
  });

  it("answers 500 with a fixed message and logs only the error name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error('relation "news_candidate_label" does not exist: secret detail');
    err.name = "PostgresError";
    applyLabel.mockRejectedValue(err);

    const res = await patch({ decision: "keep", requestId: REQUEST });
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ ok: false, error: "Could not save the label." });
    expect(text).not.toContain("secret detail");
    // Strings only: the error object itself (and its message) never reaches the log.
    expect(spy.mock.calls).toEqual([[expect.any(String), "PostgresError"]]);
    spy.mockRestore();
  });
});

describe("PATCH /api/admin/radar/[id] validation", () => {
  it("rejects a path id that is not a uuid", async () => {
    const res = await patch({ decision: "keep", requestId: REQUEST }, "not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Invalid item id." });
    expect(applyLabel).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown decision", { decision: "maybe", requestId: REQUEST }],
    ["a missing decision", { requestId: REQUEST }],
    ["a missing requestId", { decision: "keep" }],
    ["a requestId that is not a uuid", { decision: "keep", requestId: "abc" }],
    ["an ifLatestLabelId that is not a uuid", { decision: "keep", requestId: REQUEST, ifLatestLabelId: "abc" }],
    ["an unknown extra key", { decision: "keep", requestId: REQUEST, candidateId: randomUUID() }],
    ["a non-object body", ["keep"]],
  ])("rejects %s with a plain 400 and calls nothing", async (_name, body) => {
    const res = await patch(body);
    const text = await res.text();

    expect(res.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ ok: false, error: "Invalid label request." });
    expect(applyLabel).not.toHaveBeenCalled();
  });

  it("rejects unparseable JSON with 400", async () => {
    const res = await patch(undefined, ITEM, "{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Invalid JSON body." });
    expect(applyLabel).not.toHaveBeenCalled();
  });

  it("accepts a body without ifLatestLabelId (skips the stale check)", async () => {
    applyLabel.mockResolvedValue({ kind: "ok", label: null, latestLabelId: null, changed: false });

    const res = await patch({ decision: "clear", requestId: REQUEST });

    expect(res.status).toBe(200);
    expect(applyLabel).toHaveBeenCalledWith(DB, ITEM, { decision: "clear", requestId: REQUEST });
  });
});
