// POST /api/events — noop analytics sink.
//
// V1 endpoint that accepts events from `lib/analytics.ts` and discards them.
// Exists so the front-end can ship instrumentation today without coupling to
// a real backend choice (PostHog, GA4, Plausible — TBD).
//
// V2 (P2 backlog): forward to the chosen analytics backend.
//
// Returns 200 even when the payload is malformed — analytics MUST NOT be a
// source of user-visible errors, and a misshapen body has no semantic value
// to surface back. Logs to stdout in development so the dev console shows
// the same shape the production listener will eventually consume.

import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "production") {
    try {
      const body = await request.json();
      console.log("[/api/events]", body);
    } catch {
      // Ignore parse failures in dev too — keep the contract simple.
    }
  }
  return NextResponse.json({ ok: true });
}
