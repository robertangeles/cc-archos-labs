import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "./run";

// A parked draft costs a publish slot and reports nothing wrong: the item is
// terminal, the tick returns 200, the heartbeat is green, and the post simply
// never exists. At the ~50% rejection rate measured in PROD on 2026-07-26, a
// tick that gives up on the first rejection delivers about half the schedule.

vi.mock("../db", () => ({ getDb: () => ({}) }));
vi.mock("../posts-admin", () => ({ createPost: vi.fn() }));
vi.mock("../workflows/executor", () => ({ executeStep: vi.fn(), executeWorkflow: vi.fn() }));
vi.mock("../rules/service", () => ({ getEnabledRules: vi.fn(), formatRulesForInjection: vi.fn() }));
vi.mock("./judge", () => ({ judgeDraft: vi.fn() }));
vi.mock("./image", () => ({ generatePostImage: vi.fn() }));
vi.mock("../posts-admin/attach-image", () => ({
  attachImageToPost: vi.fn(),
  attachFallbackImageToPost: vi.fn(),
}));
vi.mock("./queue", () => ({
  claimNextItem: vi.fn(),
  releaseItem: vi.fn(),
  sweepStaleLocks: vi.fn(),
}));

const { runUntilDrafted } = await import("./run");

/** Feed the runner a fixed sequence of outcomes, one per call. */
function scriptRunner(outcomes: RunResult[]) {
  const runner = vi.fn<(now: Date) => Promise<RunResult>>();
  for (const o of outcomes) runner.mockResolvedValueOnce(o);
  // Anything past the script would be an unplanned extra attempt.
  runner.mockResolvedValue({ outcome: "idle" });
  return runner;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runUntilDrafted", () => {
  it("takes the next topic when the gate parks a draft", async () => {
    const runner = scriptRunner([
      { outcome: "parked", itemId: "a" },
      { outcome: "drafted", itemId: "b", postId: "p" },
    ]);

    const result = await runUntilDrafted(new Date(), { runner });

    expect(result.outcome).toBe("drafted");
    expect(result.postId).toBe("p");
    expect(result.attempts).toBe(2);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("takes the next topic when the duplicate guard skips one", async () => {
    // A skip spends nothing, so letting it consume a slot is pure waste.
    const runner = scriptRunner([
      { outcome: "skipped", itemId: "a" },
      { outcome: "drafted", itemId: "b", postId: "p" },
    ]);

    expect((await runUntilDrafted(new Date(), { runner })).outcome).toBe("drafted");
  });

  it("stops at maxAttempts rather than draining the queue", async () => {
    const runner = scriptRunner([
      { outcome: "parked", itemId: "a" },
      { outcome: "parked", itemId: "b" },
      { outcome: "parked", itemId: "c" },
      { outcome: "parked", itemId: "d" },
    ]);

    const result = await runUntilDrafted(new Date(), { runner });

    expect(result.outcome).toBe("parked");
    expect(result.attempts).toBe(3);
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("does not retry a failure, which the next topic would hit identically", async () => {
    const runner = scriptRunner([{ outcome: "failed", itemId: "a", detail: "preflight" }]);

    const result = await runUntilDrafted(new Date(), { runner });

    expect(result.outcome).toBe("failed");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it.each(["idle", "disabled", "not-due"] as const)(
    "does not retry '%s'",
    async (outcome) => {
      const runner = scriptRunner([{ outcome }]);
      await runUntilDrafted(new Date(), { runner });
      expect(runner).toHaveBeenCalledTimes(1);
    },
  );

  it("does not start an attempt past the deadline", async () => {
    // The cron runs under `curl --max-time 900`; a fourth 4.5-minute attempt
    // would be killed mid-flight, losing the work and the money spent on it.
    vi.useFakeTimers();
    const runner = vi.fn(async () => {
      vi.advanceTimersByTime(400_000);
      return { outcome: "parked" } as RunResult;
    });

    try {
      const result = await runUntilDrafted(new Date(), {
        runner,
        maxAttempts: 10,
        deadlineMs: 540_000,
      });
      // 400s elapsed still leaves room to start one more; 800s does not.
      expect(result.attempts).toBe(2);
      expect(runner).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
