// Stub analytics — fire-and-forget event posting to /api/events.
//
// V1 (this PR): dev console.log, prod POST /api/events. The endpoint is a
// noop today (200 OK, body discarded) so the front-end can ship
// instrumentation without waiting on a real backend.
//
// V2 (P2 backlog): wire /api/events to PostHog / GA4 / similar.
//
// Privacy: per CLAUDE.md, never log PII or URL query params. The track()
// signature accepts a plain props object — callers must filter their own
// payloads. This module enforces the network shape only, not the content.

export type AnalyticsEvent =
  | "page.viewed"
  | "cta.assessment.clicked"
  | "cta.bookcall.clicked"
  | "scroll.depth"
  | "anchor.nav.clicked";

export type AnalyticsProps = Record<
  string,
  string | number | boolean | null | undefined
>;

export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (typeof window === "undefined") {
    // Server-side track() calls are silently ignored. The current event set
    // is all browser-originated; if a server-side event ever needs to fire
    // it should call /api/events directly.
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    // Mirror what the network call would send, minus the wire trip.
    console.log("[analytics]", event, props ?? {});
    return;
  }

  // Production: fire-and-forget POST. Never throws, never blocks UX.
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, props: props ?? {}, ts: Date.now() }),
    keepalive: true,
  }).catch(() => {
    // Swallow. Analytics failures are not user-visible problems.
  });
}
