// When to draft. Called when Rob presses Keep and again from the radar's 2-hourly
// tick, which doubles as the sweep that restarts a job whose process died.
//
//   switch off        nothing happens, nothing is queued
//   claim             one job at a time, within the Melbourne-day cap
//   drain             after a run, the same trigger takes the next queued story,
//                     until the queue is empty or the cap is spent
//
// The claim happens before this returns, so the caller can answer fast; the run itself
// is the returned `done` promise, which the caller hands to the framework's background
// hook (Next's after()). A run that throws is logged by name and the drain goes on: one
// bad story must not hold up the next.

import type { DB } from "../../db";
import { getDraftConfig, isDraftEnabled, type DraftConfig } from "./config";
import { claimNext, enqueueKept, finishFailed, recoverStale } from "./jobs";
import type { RunDeps, runJob } from "./run";

export interface StartDeps {
  db: DB;
  now: () => Date;
  /** Builds the real dependencies (models, fetcher, image, post creation) lazily. */
  runDeps: (cfg: DraftConfig) => RunDeps;
  run: typeof runJob;
}

export type StartResult =
  | { started: false; reason: "disabled" | "nothing_to_do" }
  | { started: true; jobId: string; done: Promise<void> };

export async function startDraftIfDue(deps: StartDeps): Promise<StartResult> {
  const { db } = deps;
  if (!(await isDraftEnabled(db))) return { started: false, reason: "disabled" };
  const cfg = await getDraftConfig(db);
  const claim = () => claimNext(db, { now: deps.now(), leaseMs: cfg.leaseMinutes * 60_000, cap: cfg.dailyCap });

  await enqueueKept(db);
  await recoverStale(db, deps.now(), cfg.maxAttempts);
  const first = await claim();
  if (!first) return { started: false, reason: "nothing_to_do" };

  const done = (async () => {
    const runDeps = deps.runDeps(cfg);
    for (let job: typeof first | null = first; job; job = await claim()) {
      try {
        const outcome = await deps.run(runDeps, cfg, job);
        console.log(JSON.stringify({ event: "news_draft_job", jobId: job.id, outcome: outcome.outcome }));
      } catch (err) {
        // runJob handles its own errors; a throw past it is a bug. Fail the job now so its
        // lease does not hold up the next story, and name only the error class.
        const name = err instanceof Error ? err.name : "unknown";
        console.error("[news-draft] run threw:", name);
        await finishFailed(db, job, "crashed", name, deps.now()).catch(() => {});
      }
    }
  })().catch((err) => {
    // Never reject: an unawaited rejection crashes the process. The queue and the
    // lease already hold the truth; the next sweep recovers whatever was in flight.
    console.error("[news-draft] drain stopped:", err instanceof Error ? err.name : "unknown");
  });
  return { started: true, jobId: first.id, done };
}
