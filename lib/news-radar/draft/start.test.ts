import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDraftTestDb, type DraftTestDb } from "../../../tests/helpers/draft-test-db";
import { DEFAULT_DRAFT_CONFIG } from "./config";
import type { ClaimedJob } from "./jobs";
import { finishNeedsAttention, finishSucceeded, recoverStale } from "./jobs";
import type { JobOutcome, RunDeps } from "./run";
import { startDraftIfDue, type StartDeps } from "./start";

// startDraftIfDue decides WHETHER to start work: the switch, the queue, the lease and
// the daily cap. What a run does is runJob's business and is tested there, so runJob
// is replaced here with a recorder.

let h: DraftTestDb;
const NOW = new Date("2026-11-02T01:00:00Z");

beforeAll(async () => {
  h = await makeDraftTestDb();
});
beforeEach(async () => {
  await h.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const kept = async (title = "Story") => {
  const id = await h.addCandidate({ title });
  await h.label(id, "keep");
  return id;
};
const on = () => h.setSetting("news_draft_enabled", { enabled: true });

const build = (outcome: (job: ClaimedJob) => JobOutcome | Promise<JobOutcome> = () => ({ outcome: "succeeded", postId: "p" })) => {
  const ran: string[] = [];
  const run = vi.fn(async (_deps: RunDeps, _cfg: unknown, job: ClaimedJob) => {
    ran.push(job.title);
    const o = await outcome(job);
    // What the real runJob does before it returns.
    if (o.outcome === "succeeded") await finishSucceeded(h.db, job, await h.addPost(), NOW);
    if (o.outcome === "needs_attention") await finishNeedsAttention(h.db, job, o.reason, "test", NOW);
    return o;
  });
  const deps: StartDeps = { db: h.db, now: () => NOW, runDeps: () => ({}) as RunDeps, run: run as unknown as StartDeps["run"] };
  return { deps, run, ran };
};

describe("startDraftIfDue", () => {
  it("does nothing while the switch is off, and queues nothing", async () => {
    await kept();
    const { deps, run } = build();
    expect(await startDraftIfDue(deps)).toEqual({ started: false, reason: "disabled" });
    expect(run).not.toHaveBeenCalled();
    expect((await h.client.query(`SELECT 1 FROM news_draft_job`)).rows).toHaveLength(0);
  });

  it("does nothing when nothing is Kept", async () => {
    await on();
    const { deps, run } = build();
    expect(await startDraftIfDue(deps)).toEqual({ started: false, reason: "nothing_to_do" });
    expect(run).not.toHaveBeenCalled();
  });

  it("queues the Kept story, claims it and starts the run", async () => {
    await on();
    await kept("Qwen");
    const { deps, ran } = build();
    const r = await startDraftIfDue(deps);
    expect(r).toMatchObject({ started: true });
    if (r.started) await r.done;
    expect(ran).toEqual(["Qwen"]);
  });

  it("works through every queued story in one go, up to the daily cap", async () => {
    await on();
    await h.setSetting("news_draft_config", { dailyCap: 2 });
    for (const t of ["A", "B", "C"]) await kept(t);
    const { deps, ran } = build();
    const r = await startDraftIfDue(deps);
    if (r.started) await r.done;
    expect(ran).toEqual(["A", "B"]); // C waits for tomorrow
    // and a second trigger the same day starts nothing
    expect(await startDraftIfDue(deps)).toEqual({ started: false, reason: "nothing_to_do" });
  });

  it("does not start a second run while one holds the lease", async () => {
    await on();
    await kept("A");
    await kept("B");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { deps, ran } = build(async () => {
      await gate;
      return { outcome: "needs_attention", reason: "failed_gates" };
    });
    const first = await startDraftIfDue(deps);
    expect(first).toMatchObject({ started: true });
    expect(await startDraftIfDue(deps)).toEqual({ started: false, reason: "nothing_to_do" }); // A is running
    expect(ran).toEqual(["A"]);
    release();
    if (first.started) await first.done;
    expect(ran).toEqual(["A", "B"]); // the drain picked B up
  });

  it("switching the pipeline off mid-run stops it after the current story", async () => {
    await on();
    await kept("A");
    await kept("B");
    const { deps, ran } = build(async () => {
      await h.setSetting("news_draft_enabled", { enabled: false }); // Rob flips the switch while A is being drafted
      return { outcome: "succeeded", postId: "p" };
    });
    const r = await startDraftIfDue(deps);
    if (r.started) await r.done;
    expect(ran).toEqual(["A"]); // B stays queued until it is switched on again
    const b = (await h.client.query<{ status: string }>(`SELECT j.status FROM news_draft_job j JOIN news_candidate c ON c.id = j.candidate_id WHERE c.title = 'B'`)).rows[0];
    expect(b.status).toBe("queued");
  });

  it("a story un-Kept before its turn is skipped, not drafted", async () => {
    await on();
    const a = await kept("A");
    await kept("B");
    await h.label(a, "skip");
    const { deps, ran } = build();
    const r = await startDraftIfDue(deps);
    if (r.started) await r.done;
    expect(ran).toEqual(["B"]);
  });

  it("puts a job whose run died back in the queue and runs it", async () => {
    await on();
    const id = await kept("A");
    const { deps, ran } = build();
    // A run that took the job and then vanished.
    await h.client.query(`INSERT INTO news_draft_job (candidate_id, status, claimed_by, claimed_until, attempts, started_at) VALUES ($1,'running',gen_random_uuid(),$2,1,$2)`, [id, new Date(NOW.getTime() - 60_000)]);
    const r = await startDraftIfDue(deps);
    if (r.started) await r.done;
    expect(ran).toEqual(["A"]);
  });

  it("a run that throws does not stop the drain or surface as an unhandled rejection", async () => {
    await on();
    await kept("A");
    await kept("B");
    let n = 0;
    const { deps, ran } = build(() => {
      if (n++ === 0) throw new Error("boom");
      return { outcome: "succeeded", postId: "p" };
    });
    const r = await startDraftIfDue(deps);
    if (r.started) await r.done; // must resolve
    expect(ran).toEqual(["A", "B"]);
    // and the job that blew up is failed, not left holding its lease
    const rows = (await h.client.query<{ title: string; status: string; attention_reason: string | null }>(
      `SELECT c.title, j.status, j.attention_reason FROM news_draft_job j JOIN news_candidate c ON c.id = j.candidate_id ORDER BY c.title`,
    )).rows;
    expect(rows).toEqual([
      { title: "A", status: "failed", attention_reason: "crashed" },
      { title: "B", status: "succeeded", attention_reason: null },
    ]);
  });

  it("hands the loaded config to the dependency builder", async () => {
    await on();
    await h.setSetting("news_draft_config", { dailyCap: 2, contactEmail: "x@y.co" });
    await kept("A");
    const seen: unknown[] = [];
    const { deps } = build();
    deps.runDeps = (cfg) => {
      seen.push(cfg);
      return {} as RunDeps;
    };
    const r = await startDraftIfDue(deps);
    if (r.started) await r.done;
    expect(seen[0]).toMatchObject({ dailyCap: 2, contactEmail: "x@y.co" });
  });

  it("the background promise never rejects, even if the database fails mid-drain", async () => {
    await on();
    await kept("A");
    await kept("B");
    const { deps } = build(async () => {
      // the queue breaks after the first job
      await h.client.exec(`ALTER TABLE news_draft_job RENAME TO news_draft_job_gone`);
      return { outcome: "succeeded", postId: "p" };
    });
    try {
      const r = await startDraftIfDue(deps);
      expect(r.started).toBe(true);
      if (r.started) await expect(r.done).resolves.toBeUndefined();
    } finally {
      // the database is shared by the whole file: put the table back for the next test
      await h.client.exec(`ALTER TABLE IF EXISTS news_draft_job_gone RENAME TO news_draft_job`);
    }
  });

  it("reads the config for the cap and the lease", async () => {
    await on();
    await h.setSetting("news_draft_config", { dailyCap: 1 });
    await kept("A");
    await kept("B");
    const { deps, ran } = build();
    const r = await startDraftIfDue(deps);
    if (r.started) await r.done;
    expect(ran).toEqual(["A"]);
  });

  it("a broken config stops the start with an error instead of running with surprise settings", async () => {
    await on();
    await h.setSetting("news_draft_config", { dailyCap: 99 });
    await kept("A");
    await expect(startDraftIfDue(build().deps)).rejects.toThrow(/news_draft_config/);
  });

  it("recoverStale is part of every start", async () => {
    await on();
    const spy = vi.spyOn(await import("./jobs"), "recoverStale");
    await startDraftIfDue(build().deps);
    expect(spy).toHaveBeenCalled();
    void recoverStale;
    void DEFAULT_DRAFT_CONFIG;
  });
});
