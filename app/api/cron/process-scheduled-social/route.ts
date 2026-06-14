import { type NextRequest, NextResponse } from "next/server";
import { processScheduledSocial } from "../../../../lib/social/cron-publisher";

// POST /api/cron/process-scheduled-social
//
// External cron (Render Cron) hits this on a schedule. Auth is a Bearer
// token shared via CRON_SECRET. Dequeues pending scheduled social posts,
// publishes them, and returns a summary.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // 1. Auth ---------------------------------------------------------------
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error(
      "[cron/process-scheduled-social] CRON_SECRET not set or too short",
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

  // 2. Process ------------------------------------------------------------
  try {
    const result = await processScheduledSocial(new Date());
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.split("\n").slice(0, 3).join("\n") : "";
    console.error("[cron/process-scheduled-social] unhandled error:", msg, stack);
    return NextResponse.json(
      { ok: false, error: "Internal error.", detail: msg },
      { status: 500 },
    );
  }
}
