import "server-only";
import { getSiteUrl } from "./site-config";

// IndexNow push-indexing client. Pings the global IndexNow endpoint
// (`api.indexnow.org`) which fans out to Bing, Yandex, Naver, Seznam.cz,
// Yep, and Amazon. Google does NOT participate as of 2026-05.
//
// Why this exists: the sitemap.xml feeds slow crawl-discovery (days);
// IndexNow gives engines a real-time push when a post is published,
// updated, or removed. Discovery latency drops from hours-to-days to
// minutes for the engines that matter most to AIEO (Bing → Copilot →
// ChatGPT-Browse).
//
// Trigger points (call sites import `pingIndexNow`):
//   - lib/posts-admin: createPost (when status='published'), updatePost
//     (every save while published), archivePost (signals 404), restorePost.
//   - lib/pages: createPage, updatePage, archivePage, restoreFromArchive.
//   - lib/posts-admin/scheduled-publisher: batch-ping all slugs the
//     cron just flipped.
//
// Posture:
//   - Fire-and-forget. Caller never awaits — a slow/failed ping must
//     not block a save UX. Returns a Promise but exceptions are swallowed
//     with a console.error.
//   - Skipped silently when INDEXNOW_KEY is unset OR NODE_ENV !==
//     'production'. Dev edits don't generate noise on Bing's side.
//   - Same-URL 5-minute debounce. Per IndexNow FAQ guidance to avoid
//     submitting unchanged content repeatedly during active editing.
//     In-memory Map; resets on container restart, which is acceptable —
//     worst case is one extra ping after deploy.
//
// Key file: written to `public/{INDEXNOW_KEY}.txt` at build time by
// `scripts/write-indexnow-keyfile.mjs` (wired via `prebuild` in
// package.json). Engines fetch `https://<host>/{key}.txt` automatically
// when they receive a ping containing `key` — no `keyLocation` needed
// (IndexNow "Option 1" per the Bing getting-started docs). The
// build-time generation keeps the key out of git: only env-var changes,
// no file commits, are required to rotate.

const ENDPOINT = "https://api.indexnow.org/indexnow";
const DEBOUNCE_MS = 5 * 60 * 1000;
const DEBOUNCE_CLEANUP_MS = 60 * 60 * 1000;

// Module-scoped state. Render runs a single container per service; this
// is safe across requests in that topology. A second instance would
// double-ping, which is not catastrophic (just slightly wasteful) until
// we move to a Redis/DB-backed log.
const lastPingAt = new Map<string, number>();

/**
 * Submit one or more URLs to IndexNow. Fire-and-forget — the returned
 * promise resolves to a result object the caller MAY inspect for
 * logging, but is more typically discarded:
 *
 *   pingIndexNow([`${siteUrl}/blog/${slug}`]).catch(() => {});
 *
 * URLs must be fully-qualified (`https://archoslabs.xyz/...`). The
 * function does not validate that — the host must match the site origin
 * the engines saw when verifying the key file, otherwise they respond
 * 422 and the ping is wasted.
 */
export interface PingResult {
  status: "ok" | "skipped" | "failed";
  /** Reason for `skipped` — useful for logging. */
  reason?:
    | "no-key"
    | "non-production"
    | "no-urls"
    | "all-debounced";
  /** HTTP status from the IndexNow endpoint when status='ok' or 'failed'. */
  httpStatus?: number;
  /** Count of URLs that were actually submitted (post-debounce filter). */
  submitted?: number;
}

export async function pingIndexNow(urls: string[]): Promise<PingResult> {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key) {
    return { status: "skipped", reason: "no-key" };
  }
  if (process.env.NODE_ENV !== "production") {
    return { status: "skipped", reason: "non-production" };
  }
  if (urls.length === 0) {
    return { status: "skipped", reason: "no-urls" };
  }

  // Filter out URLs we pinged in the last 5 minutes. Also drop any
  // duplicates inside the incoming list.
  const now = Date.now();
  const seen = new Set<string>();
  const toSubmit: string[] = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    const prev = lastPingAt.get(u);
    if (prev !== undefined && now - prev < DEBOUNCE_MS) continue;
    toSubmit.push(u);
  }

  // Periodic cleanup: drop entries older than 1 hour so the Map can't
  // grow unboundedly when many distinct URLs ping over the lifetime of
  // the container.
  if (lastPingAt.size > 1000) {
    for (const [u, ts] of lastPingAt) {
      if (now - ts > DEBOUNCE_CLEANUP_MS) lastPingAt.delete(u);
    }
  }

  if (toSubmit.length === 0) {
    return { status: "skipped", reason: "all-debounced" };
  }

  const siteUrl = getSiteUrl();
  const host = new URL(siteUrl).host;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        urlList: toSubmit,
      }),
    });

    // Mark debounce timestamps regardless of HTTP outcome — a 429 or 422
    // doesn't get auto-retried in this implementation, and a failed
    // submission shouldn't keep banging on the endpoint every save.
    for (const u of toSubmit) lastPingAt.set(u, now);

    // 200 (success) and 202 (accepted but not yet processed) are both
    // OK per FAQ. Anything else is a failure mode worth logging.
    if (res.status !== 200 && res.status !== 202) {
      console.error(
        `[indexnow] ${res.status} ${res.statusText} — submitted ${toSubmit.length} url(s)`,
      );
      return {
        status: "failed",
        httpStatus: res.status,
        submitted: toSubmit.length,
      };
    }

    return {
      status: "ok",
      httpStatus: res.status,
      submitted: toSubmit.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[indexnow] fetch threw: ${msg}`);
    // Still record the timestamps so a transient network blip doesn't
    // turn into a flood of retries on the next save.
    for (const u of toSubmit) lastPingAt.set(u, now);
    return { status: "failed", submitted: toSubmit.length };
  }
}

/**
 * Test-only: clear the debounce state so unit tests can re-submit the
 * same URL within a single run. Not exported to non-test code paths
 * (named with the `__` prefix to signal "internal").
 */
export function __resetDebounceForTests(): void {
  lastPingAt.clear();
}
