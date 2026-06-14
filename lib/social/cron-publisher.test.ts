import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./publish", () => ({
  publishToSocial: vi.fn(),
}));

vi.mock("../resend", () => ({
  getResend: vi.fn().mockResolvedValue({
    resend: { emails: { send: vi.fn().mockResolvedValue({}) } },
    from: "test@test.com",
  }),
}));

vi.mock("./schedule-emails", () => ({
  buildPublishConfirmEmail: vi.fn().mockReturnValue({
    subject: "Published",
    text: "Done",
    html: "<p>Done</p>",
  }),
}));

import { processScheduledSocial } from "./cron-publisher";
import { publishToSocial } from "./publish";
import { getDb } from "../db";

const mockPublish = publishToSocial as ReturnType<typeof vi.fn>;
const mockGetDb = getDb as ReturnType<typeof vi.fn>;

function makeMockDb(opts: {
  staleRows?: Array<{ id: string }>;
  dueRows?: Array<{
    id: string;
    user_id: string;
    platform: string;
    content: string;
    attempts: number;
  }>;
  userEmail?: string;
}) {
  const updateSets: Array<Record<string, unknown>> = [];
  let selectCount = 0;

  const chainWhere = vi.fn().mockImplementation(() => {
    selectCount++;
    if (selectCount === 1) return Promise.resolve(opts.staleRows ?? []);
    return {
      limit: vi.fn().mockResolvedValue(
        opts.userEmail ? [{ email: opts.userEmail }] : [],
      ),
    };
  });

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: chainWhere,
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((sets: Record<string, unknown>) => {
        updateSets.push(sets);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const mappedRows = (opts.dueRows ?? []).map((r) => ({
        id: r.id,
        userId: r.user_id,
        platform: r.platform,
        content: r.content,
        attempts: r.attempts,
      }));
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  for: vi.fn().mockResolvedValue(mappedRows),
                }),
              }),
            }),
          }),
        }),
        execute: vi.fn().mockResolvedValue(opts.dueRows ?? []),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      return fn(tx);
    }),
    _updateSets: updateSets,
    _resetSelectCount: () => { selectCount = 0; },
  };

  return db;
}

describe("processScheduledSocial", () => {
  const now = new Date("2026-06-14T09:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early with zero processed when no rows are due", async () => {
    const db = makeMockDb({ dueRows: [] });
    mockGetDb.mockReturnValue(db);

    const result = await processScheduledSocial(now);

    expect(result.ok).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.published).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("publishes successfully and settles row as published", async () => {
    const db = makeMockDb({
      dueRows: [
        { id: "s1", user_id: "u1", platform: "twitter", content: "Hello!", attempts: 0 },
      ],
      userEmail: "rob@test.com",
    });
    mockGetDb.mockReturnValue(db);
    mockPublish.mockResolvedValue({
      results: [{ platform: "twitter", status: "success", publishedUrl: "https://x.com/123" }],
    });

    const result = await processScheduledSocial(now);

    expect(result.published).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockPublish).toHaveBeenCalledOnce();
    const settleUpdate = db._updateSets.find(
      (s) => s.status === "published",
    );
    expect(settleUpdate).toBeDefined();
    expect(settleUpdate?.publishedUrl).toBe("https://x.com/123");
  });

  it("retries on error when attempts < MAX_ATTEMPTS", async () => {
    const db = makeMockDb({
      dueRows: [
        { id: "s2", user_id: "u1", platform: "linkedin", content: "Test", attempts: 0 },
      ],
    });
    mockGetDb.mockReturnValue(db);
    mockPublish.mockResolvedValue({
      results: [{ platform: "linkedin", status: "error", error: "Rate limited" }],
    });

    const result = await processScheduledSocial(now);

    expect(result.published).toBe(0);
    expect(result.details[0]?.outcome).toBe("retry");
    const retryUpdate = db._updateSets.find((s) => s.status === "pending");
    expect(retryUpdate).toBeDefined();
  });

  it("marks terminal failure when attempts >= MAX_ATTEMPTS", async () => {
    const db = makeMockDb({
      dueRows: [
        { id: "s3", user_id: "u1", platform: "bluesky", content: "Test", attempts: 2 },
      ],
    });
    mockGetDb.mockReturnValue(db);
    mockPublish.mockResolvedValue({
      results: [{ platform: "bluesky", status: "error", error: "Server error" }],
    });

    const result = await processScheduledSocial(now);

    expect(result.failed).toBe(1);
    expect(result.details[0]?.outcome).toBe("failed");
    const failUpdate = db._updateSets.find((s) => s.status === "failed");
    expect(failUpdate).toBeDefined();
  });

  it("marks failed with clear message on reconnect_required", async () => {
    const db = makeMockDb({
      dueRows: [
        { id: "s4", user_id: "u1", platform: "twitter", content: "Test", attempts: 0 },
      ],
    });
    mockGetDb.mockReturnValue(db);
    mockPublish.mockResolvedValue({
      results: [{ platform: "twitter", status: "reconnect_required" }],
    });

    const result = await processScheduledSocial(now);

    expect(result.failed).toBe(1);
    const failUpdate = db._updateSets.find((s) => s.status === "failed");
    expect(failUpdate).toBeDefined();
    expect(failUpdate?.errorMessage).toContain("Token expired");
    expect(failUpdate?.errorMessage).toContain("twitter");
  });

  it("recovers stale locks before dequeuing", async () => {
    const db = makeMockDb({
      staleRows: [{ id: "stale1" }, { id: "stale2" }],
      dueRows: [],
    });
    mockGetDb.mockReturnValue(db);

    const result = await processScheduledSocial(now);

    expect(result.recovered).toBe(2);
    const recoveryUpdate = db._updateSets.find(
      (s) => s.status === "pending" && s.lockedBy === null,
    );
    expect(recoveryUpdate).toBeDefined();
  });

  it("groups rows by userId+platform for serial processing", async () => {
    const callOrder: string[] = [];
    const db = makeMockDb({
      dueRows: [
        { id: "s1", user_id: "u1", platform: "twitter", content: "First", attempts: 0 },
        { id: "s2", user_id: "u1", platform: "twitter", content: "Second", attempts: 0 },
        { id: "s3", user_id: "u2", platform: "linkedin", content: "Third", attempts: 0 },
      ],
      userEmail: "test@test.com",
    });
    mockGetDb.mockReturnValue(db);

    mockPublish.mockImplementation(async (_userId: string, req: Record<string, unknown>) => {
      const platforms = req.platforms as Record<string, { content: string }>;
      const content = Object.values(platforms)[0]?.content ?? "";
      callOrder.push(content);
      await new Promise((r) => setTimeout(r, 10));
      return {
        results: [{ platform: Object.keys(platforms)[0], status: "success", publishedUrl: "https://example.com" }],
      };
    });

    await processScheduledSocial(now);

    const firstIdx = callOrder.indexOf("First");
    const secondIdx = callOrder.indexOf("Second");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(mockPublish).toHaveBeenCalledTimes(3);
  });
});
