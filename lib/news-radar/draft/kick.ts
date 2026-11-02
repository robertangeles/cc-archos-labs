import "server-only";
import { getDb } from "../../db";
import { inBackground } from "./background";
import { runJob } from "./run";
import { startDraftIfDue } from "./start";
import { makeRunDeps } from "./wire";

/**
 * Start drafting if there is something to draft. Called when Rob presses Keep and
 * from the radar's 2-hourly tick. Returns at once; the work runs after the response.
 * The switch, the daily cap and the one-at-a-time lease are all decided in
 * startDraftIfDue, so calling this more often than needed is harmless.
 */
export function kickDrafting(): void {
  inBackground(async () => {
    const db = getDb();
    const started = await startDraftIfDue({ db, now: () => new Date(), runDeps: (cfg) => makeRunDeps(db, cfg), run: runJob });
    if (started.started) await started.done;
  });
}
