import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateConversationalFollowup } from "../../../../lib/claude-booking";

// POST /api/booking/intake-followup
//
// Called once from the booking form after the prospect types their
// initial reason but before they pick the slot. Claude reads the reason
// and decides whether ONE sharpening follow-up question would unlock
// useful context. The form then renders the follow-up inline; the
// prospect's answer joins the reason payload in /create.
//
// Failure mode: any Claude error returns { followup: null } — the page
// proceeds with a static intake. The booking still goes through; the
// pre-call brief (PR #44 cron) just has slightly less material.

export const runtime = "nodejs";

const BodySchema = z.object({
  reasonInitial: z.string().min(1).max(2000),
});

export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    const body = await request.json();
    parsed = BodySchema.parse(body);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  try {
    const result = await generateConversationalFollowup({
      reasonInitial: parsed.reasonInitial,
    });
    return NextResponse.json({
      ok: true,
      followup: result.followup,
    });
  } catch (err) {
    console.warn("[booking/intake-followup] failed:", err);
    // Soft-fail: page falls back to static intake.
    return NextResponse.json({ ok: true, followup: null });
  }
}
