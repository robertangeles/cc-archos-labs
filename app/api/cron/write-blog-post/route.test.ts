import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Auth surface for the one endpoint that can spend money and create content.
// CLAUDE.md requires a penetration test per new endpoint; this is it, plus the
// happy path and the empty-queue case.

// The route drives runUntilDrafted, which walks past a parked draft to the
// next topic. These tests are about the ROUTE (auth, heartbeat, response
// shape), so the retry policy itself is mocked out and covered separately in
// lib/blog-agent/run.retry.test.ts.
const runMock = vi.fn();
const pendingCountMock = vi.fn();
const generateBatchMock = vi.fn();
const sendAlertMock = vi.fn();
const getConfigMock = vi.fn();

vi.mock("../../../../lib/blog-agent/run", () => ({
  runUntilDrafted: () => runMock(),
}));
vi.mock("../../../../lib/blog-agent/queue", () => ({
  pendingCount: () => pendingCountMock(),
}));
vi.mock("../../../../lib/blog-agent/plan", () => ({
  generateBatch: (c: unknown) => generateBatchMock(c),
}));
vi.mock("../../../../lib/blog-agent/alert", () => ({
  sendAlert: (a: unknown) => sendAlertMock(a),
  describeRunFailure: () => "failure description",
}));
vi.mock("../../../../lib/blog-agent/config", () => ({
  getBlogAgentConfig: () => getConfigMock(),
}));
// The heartbeat writes directly; stub the DB so no connection is attempted.
vi.mock("../../../../lib/db", () => ({
  getDb: () => {
    throw new Error("no db in unit tests");
  },
}));

const { POST } = await import("./route");

const SECRET = "a-sufficiently-long-cron-secret";

function req(auth?: string) {
  return new NextRequest("https://archoslabs.xyz/api/cron/write-blog-post", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  runMock.mockResolvedValue({ outcome: "idle" });
  pendingCountMock.mockResolvedValue(99);
  generateBatchMock.mockResolvedValue({ inserted: 0 });
  sendAlertMock.mockResolvedValue(true);
  getConfigMock.mockResolvedValue({
    enabled: true,
    minQueueDepth: 7,
    alertEmail: "rob@example.com",
  });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe("auth", () => {
  it("503s when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("503s when CRON_SECRET is too short to be a real secret", async () => {
    process.env.CRON_SECRET = "short";
    const res = await POST(req("Bearer short"));
    expect(res.status).toBe(503);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("401s with no Authorization header", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("401s with a wrong token", async () => {
    const res = await POST(req("Bearer definitely-not-the-secret"));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("401s when the token is right but the scheme is not Bearer", async () => {
    const res = await POST(req(`Basic ${SECRET}`));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("401s on a prefix of the real secret", async () => {
    const res = await POST(req(`Bearer ${SECRET.slice(0, -1)}`));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("200s with the correct token", async () => {
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledOnce();
  });
});

describe("run outcomes", () => {
  it("reports an empty queue without treating it as a failure", async () => {
    runMock.mockResolvedValue({ outcome: "idle" });
    const res = await POST(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, outcome: "idle" });
    expect(sendAlertMock).not.toHaveBeenCalled();
  });

  it("reports not-due without doing work", async () => {
    runMock.mockResolvedValue({ outcome: "not-due" });
    const body = await (await POST(req(`Bearer ${SECRET}`))).json();
    expect(body.outcome).toBe("not-due");
    expect(body.ok).toBe(true);
  });

  it("alerts and reports not-ok when a draft is parked", async () => {
    runMock.mockResolvedValue({
      outcome: "parked",
      itemId: "i1",
      postId: "p1",
      detail: "failed the gate twice",
    });
    const body = await (await POST(req(`Bearer ${SECRET}`))).json();
    expect(body.ok).toBe(false);
    expect(body.outcome).toBe("parked");
    expect(sendAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "draft-parked" }),
    );
  });

  it("alerts when the sweeper gives up on items", async () => {
    runMock.mockResolvedValue({
      outcome: "idle",
      swept: { reclaimed: 0, exhausted: 2, exhaustedIds: ["a", "b"] },
    });
    await POST(req(`Bearer ${SECRET}`));
    expect(sendAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "locks-exhausted" }),
    );
  });

  it("503s but does not throw when the agent itself throws", async () => {
    runMock.mockRejectedValue(new Error("boom"));
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toBe("boom");
  });
});

describe("queue refill", () => {
  it("refills when the queue drops below the configured depth", async () => {
    pendingCountMock.mockResolvedValue(2);
    generateBatchMock.mockResolvedValue({ inserted: 14 });
    const body = await (await POST(req(`Bearer ${SECRET}`))).json();
    expect(generateBatchMock).toHaveBeenCalledOnce();
    expect(body.refill).toMatchObject({ inserted: 14 });
  });

  it("does not refill while the queue is deep enough", async () => {
    pendingCountMock.mockResolvedValue(50);
    await POST(req(`Bearer ${SECRET}`));
    expect(generateBatchMock).not.toHaveBeenCalled();
  });

  it("alerts when a refill produces nothing", async () => {
    pendingCountMock.mockResolvedValue(1);
    generateBatchMock.mockResolvedValue({ inserted: 0, error: "research returned nothing" });
    await POST(req(`Bearer ${SECRET}`));
    expect(sendAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "queue-dry" }),
    );
  });

  it("skips refill entirely when the agent is disabled", async () => {
    getConfigMock.mockResolvedValue({
      enabled: false,
      minQueueDepth: 7,
      alertEmail: "",
    });
    await POST(req(`Bearer ${SECRET}`));
    expect(pendingCountMock).not.toHaveBeenCalled();
    expect(generateBatchMock).not.toHaveBeenCalled();
  });
});
