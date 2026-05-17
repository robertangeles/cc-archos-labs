import { type NextRequest, NextResponse } from "next/server";
import { getConsultantBySlug, loadAvailableSlots } from "../../../../../lib/booking";

// GET /api/booking/[slug]/availability
//
// Public endpoint. Returns the list of available slot start/end pairs
// for a consultant within their advance-days window, computed live each
// call so the page never shows stale availability.
//
// Response shape: { ok: true, slots: [{ startUtc, endUtc }], freebusyOk: boolean }
// freebusyOk=false signals the UI to show a soft "calendar sync delay"
// warning — slots may double-book against a Google event we couldn't
// reach.

export const runtime = "nodejs";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { slug } = await params;

  const c = await getConsultantBySlug(slug);
  if (!c) {
    return NextResponse.json(
      { ok: false, error: "Consultant not found." },
      { status: 404 },
    );
  }

  // No bookings allowed if Google isn't connected at all — surface
  // clearly to the page so it can render a "coming soon" state.
  if (c.googleStatus !== "ok") {
    return NextResponse.json(
      {
        ok: false,
        error: "Booking is paused — consultant has not yet connected their calendar.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await loadAvailableSlots({ consultant: c, now: new Date() });
    return NextResponse.json({
      ok: true,
      slots: result.slots,
      freebusyOk: result.freebusyOk,
      consultant: {
        displayName: c.displayName,
        timezone: c.timezone,
        slotMinutes: c.slotMinutes,
      },
    });
  } catch (err) {
    console.error("[booking/availability] failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not load availability." },
      { status: 500 },
    );
  }
}
