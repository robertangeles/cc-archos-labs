import { type NextRequest, NextResponse } from "next/server";
import { purgeInactiveLeads } from "../../../../lib/retention/purge-inactive-leads";

// POST /api/cron/purge-inactive-leads
//
// Daily Render Cron hits this endpoint to enforce the 24-month inactivity
// window on lead accounts (per /privacy). Deletes the lead row plus all
// linked assessment_session + report_output + share_token + magic_link_token
// rows for leads with no activity in 24 months.
//
// Auth is the shared Bearer CRON_SECRET — every other caller is rejected
// with 401. Idempotent: rerunning the same day finds zero candidates.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error(
      "[cron/purge-inactive-leads] CRON_SECRET not set or too short",
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
    const result = await purgeInactiveLeads({ now: new Date() });
    return NextResponse.json({
      ok: true,
      leadsDeleted: result.leadsDeleted,
      sessionsDeleted: result.sessionsDeleted,
      cutoffAt: result.cutoffAt,
      durationMs: Date.now() - runStart,
    });
  } catch (err) {
    console.error("[cron/purge-inactive-leads] purge failed:", err);
    return NextResponse.json(
      { ok: false, error: "Purge failed." },
      { status: 500 },
    );
  }
}
