import { after } from "next/server";

/**
 * Run work after the HTTP response has been sent, so a label press or a cron call is
 * answered at once while a draft takes its five or six minutes. On the Node server
 * Next's after() keeps the work going until it finishes. Outside a request (tests,
 * scripts) after() throws, and the work simply runs in place. Never throws, and never
 * leaves a rejected promise behind: an unawaited rejection would crash the process.
 */
export function inBackground(work: () => Promise<void>): void {
  const safe = async () => {
    try {
      await work();
    } catch (err) {
      console.error("[news-draft] background work failed:", err instanceof Error ? err.name : "unknown");
    }
  };
  try {
    after(safe);
  } catch {
    void safe();
  }
}
