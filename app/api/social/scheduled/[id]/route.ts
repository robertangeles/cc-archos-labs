import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { scheduledSocialPost } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// PATCH /api/social/scheduled/[id] — reschedule a pending post
// ---------------------------------------------------------------------------
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { scheduledFor, displayTimezone } = body as {
    scheduledFor?: string;
    displayTimezone?: string;
  };

  // --- Validate scheduledFor ---
  if (!scheduledFor || typeof scheduledFor !== "string") {
    return NextResponse.json(
      { ok: false, error: "scheduledFor is required (ISO 8601)." },
      { status: 400 },
    );
  }

  const scheduledDate = new Date(scheduledFor);
  if (isNaN(scheduledDate.getTime())) {
    return NextResponse.json(
      { ok: false, error: "scheduledFor is not a valid date." },
      { status: 400 },
    );
  }

  const oneMinuteFromNow = new Date(Date.now() + 60_000);
  if (scheduledDate < oneMinuteFromNow) {
    return NextResponse.json(
      { ok: false, error: "scheduledFor must be at least 1 minute in the future." },
      { status: 400 },
    );
  }

  // --- Validate optional displayTimezone ---
  if (displayTimezone !== undefined && (typeof displayTimezone !== "string" || !displayTimezone.trim())) {
    return NextResponse.json(
      { ok: false, error: "displayTimezone must be a non-empty string if provided." },
      { status: 400 },
    );
  }

  try {
    const db = getDb();

    // Fetch the post (IDOR check: scoped to current user)
    const rows = await db
      .select({
        id: scheduledSocialPost.id,
        status: scheduledSocialPost.status,
      })
      .from(scheduledSocialPost)
      .where(
        and(
          eq(scheduledSocialPost.id, id),
          eq(scheduledSocialPost.userId, user.user.id),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Scheduled post not found." },
        { status: 404 },
      );
    }

    if (rows[0].status !== "pending") {
      return NextResponse.json(
        { ok: false, error: "Only pending posts can be rescheduled." },
        { status: 409 },
      );
    }

    // --- Update ---
    const updates: Record<string, unknown> = {
      scheduledFor: scheduledDate,
      updatedAt: new Date(),
    };
    if (displayTimezone) {
      updates.displayTimezone = displayTimezone.trim();
    }

    await db
      .update(scheduledSocialPost)
      .set(updates)
      .where(eq(scheduledSocialPost.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[social/scheduled/[id]] PATCH error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to reschedule post." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/social/scheduled/[id] — cancel a pending post
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { id } = await params;

  try {
    const db = getDb();

    // Fetch the post (IDOR check: scoped to current user)
    const rows = await db
      .select({
        id: scheduledSocialPost.id,
        status: scheduledSocialPost.status,
      })
      .from(scheduledSocialPost)
      .where(
        and(
          eq(scheduledSocialPost.id, id),
          eq(scheduledSocialPost.userId, user.user.id),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Scheduled post not found." },
        { status: 404 },
      );
    }

    if (rows[0].status !== "pending") {
      return NextResponse.json(
        { ok: false, error: "Only pending posts can be cancelled." },
        { status: 409 },
      );
    }

    // Soft-cancel: set status to 'cancelled'
    await db
      .update(scheduledSocialPost)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(scheduledSocialPost.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[social/scheduled/[id]] DELETE error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to cancel post." },
      { status: 500 },
    );
  }
}
