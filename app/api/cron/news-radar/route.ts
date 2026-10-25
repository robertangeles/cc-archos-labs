import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "../../../../lib/auth";
import { touchHeartbeat } from "../../../../lib/cron-heartbeat";
import { runTick } from "../../../../lib/news-radar/radar";

// POST /api/cron/news-radar
//
// Render Cron hits this every 2 hours (0 */2 * * *, UTC). Auth is the shared
// CRON_SECRET Bearer token, like every other cron route. The route only
// authenticates, picks the slot, delegates to runTick and records the
// heartbeat; the work and the tick log live in lib/news-radar/radar.ts.
//
// The slot is the 2-hour UTC boundary the request falls in, so a late or
// manually repeated call within the same slot targets the same tick row.
//
// A tick that CRASHES (runTick throws) leaves no tick row and no heartbeat
// touch, which is exactly how a missed slot shows up on /api/health/cron.

export const runtime = "nodejs";

const HEARTBEAT_ID = "news-radar";
const SLOT_MS = 2 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error("[cron/news-radar] CRON_SECRET not set or too short");
    return NextResponse.json(
      { ok: false, error: "Cron not configured." },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!timingSafeEqual(presented, expected)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const runStart = Date.now();
  const slotAt = new Date(Math.floor(runStart / SLOT_MS) * SLOT_MS);

  let result;
  try {
    result = await runTick(slotAt);
  } catch (err) {
    // Error name only: a message can carry a feed title or a key fragment.
    console.error(
      "[cron/news-radar] tick crashed:",
      err instanceof Error ? err.name : "unknown",
    );
    return NextResponse.json(
      { ok: false, error: "Tick crashed." },
      { status: 503 },
    );
  }

  await touchHeartbeat(HEARTBEAT_ID, {
    processed: result.scored,
    failed: result.failedCount + result.unscored,
    durationMs: Date.now() - runStart,
  });

  return NextResponse.json(
    {
      ok: result.outcome !== "failed",
      dormant: result.outcome === "disabled",
      outcome: result.outcome,
      slotAt: slotAt.toISOString(),
      fetched: result.fetched,
      newCount: result.newCount,
      scored: result.scored,
      unscored: result.unscored,
      failedCount: result.failedCount,
      errorClass: result.errorClass,
      rubricVersion: result.rubricVersion,
    },
    { status: result.outcome === "failed" ? 503 : 200 },
  );
}
