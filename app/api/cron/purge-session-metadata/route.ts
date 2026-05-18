import { type NextRequest, NextResponse } from "next/server";
import { purgeOldSessionMetadata } from "../../../../lib/retention/purge-session-metadata";

// POST /api/cron/purge-session-metadata
//
// Daily Render Cron hits this endpoint to enforce the 30-day retention
// window on assessment_session.ip_address + .user_agent (per /privacy).
// Auth is the shared Bearer CRON_SECRET — every other caller (including
// the public web) is rejected with 401.
//
// Idempotent: rerunning the same day is a no-op because the WHERE clause
// excludes rows already nulled.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Auth — mirrors the pattern in /api/cron/process-scheduled.
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error(
      "[cron/purge-session-metadata] CRON_SECRET not set or too short",
    );
    return NextResponse.json(
      { ok: false, error: "Cron not configured." },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (presented !== expected) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const runStart = Date.now();
  try {
    const result = await purgeOldSessionMetadata({ now: new Date() });
    return NextResponse.json({
      ok: true,
      rowsAffected: result.rowsAffected,
      cutoffAt: result.cutoffAt,
      durationMs: Date.now() - runStart,
    });
  } catch (err) {
    console.error("[cron/purge-session-metadata] purge failed:", err);
    return NextResponse.json(
      { ok: false, error: "Purge failed." },
      { status: 500 },
    );
  }
}
