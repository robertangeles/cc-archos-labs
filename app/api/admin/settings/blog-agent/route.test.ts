import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOG_AGENT_CONFIG_STARTER } from "../../../../../lib/blog-agent/config-shared";

// The settings endpoint behind the kill switch. Until this existed, stopping
// the agent meant a hand-written UPDATE against site_setting, and the runbook
// pointed at a page that 404'd.
//
// What matters here is that a bad payload can never be written: the stored row
// is what getBlogAgentConfig validates, and an invalid row silently degrades
// the agent to the disabled starter.

const rows: Array<{ value: unknown; updatedAt: Date }> = [];
const insertValues = vi.fn();

vi.mock("../../../../../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => rows }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  }),
}));

const { GET, PUT } = await import("./route");

function put(body: unknown) {
  return new Request("https://archoslabs.xyz/api/admin/settings/blog-agent", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = {
  ...BLOG_AGENT_CONFIG_STARTER,
  workflowId: "11111111-1111-4111-8111-111111111111",
  runAsUserId: "22222222-2222-4222-8222-222222222222",
  authorId: "33333333-3333-4333-8333-333333333333",
};

afterEach(() => {
  rows.length = 0;
  vi.clearAllMocks();
});

describe("GET", () => {
  it("returns the disabled starter when nothing is stored", async () => {
    const json = await (await GET()).json();
    expect(json.ok).toBe(true);
    expect(json.isFallback).toBe(true);
    // The starter must never arrive enabled — a fallback that runs the
    // pipeline against placeholder ids is the wrong failure direction.
    expect(json.data.enabled).toBe(false);
  });

  it("returns the stored config when it is valid", async () => {
    rows.push({ value: VALID, updatedAt: new Date("2026-07-26T00:00:00Z") });
    const json = await (await GET()).json();
    expect(json.isFallback).toBe(false);
    expect(json.data.workflowId).toBe(VALID.workflowId);
  });

  it("names the broken fields instead of quietly showing the starter", async () => {
    // This is the state where the agent is NOT running and nothing says so.
    rows.push({ value: { ...VALID, judgeModel: "" }, updatedAt: new Date() });
    const json = await (await GET()).json();
    expect(json.isFallback).toBe(true);
    expect(json.invalidFields).toContain("judgeModel");
  });
});

describe("PUT rejects anything that would disable the agent by accident", () => {
  it("saves a valid config", async () => {
    const res = await PUT(put(VALID));
    expect(res.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ key: "blog_agent_config" }),
    );
  });

  it("rejects malformed JSON", async () => {
    const res = await PUT(put("{not json"));
    expect(res.status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid workflow id", async () => {
    const res = await PUT(put({ ...VALID, workflowId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("workflowId");
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects a grounding ratio outside 0-1", async () => {
    expect((await PUT(put({ ...VALID, minGroundingRatio: 5 }))).status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects an empty link allowlist", async () => {
    // Empty would mean every external link is off-list and stripped, which
    // looks like the gate malfunctioning rather than a config mistake.
    expect((await PUT(put({ ...VALID, linkAllowlist: [] }))).status).toBe(400);
  });

  it("rejects a cadence entry above 7 posts per week", async () => {
    const bad = { ...VALID, velocity: { startDate: "2026-01-01", weeklyRamp: [99] } };
    expect((await PUT(put(bad))).status).toBe(400);
  });

  it("rejects a malformed alert email but allows empty", async () => {
    expect((await PUT(put({ ...VALID, alertEmail: "nope" }))).status).toBe(400);
    expect((await PUT(put({ ...VALID, alertEmail: "" }))).status).toBe(200);
  });

  it("accepts a config written before illustrations existed", async () => {
    // image is defaulted, not required. A required key would fail validation
    // on every stored config and drop the agent to the disabled starter.
    const { image: _image, ...withoutImage } = VALID;
    const res = await PUT(put(withoutImage));
    expect(res.status).toBe(200);
    expect((await res.json()).data.image).toEqual({ enabled: true });
  });

  it("persists the enabled flag in both directions", async () => {
    await PUT(put({ ...VALID, enabled: true }));
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.objectContaining({ enabled: true }) }),
    );
    vi.clearAllMocks();
    await PUT(put({ ...VALID, enabled: false }));
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.objectContaining({ enabled: false }) }),
    );
  });
});
