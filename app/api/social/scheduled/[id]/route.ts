import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { scheduledSocialPost } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { isSocialPlatform, PLATFORM_MAX_CHAR_LIMITS } from "@/lib/social/types";

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

  const { scheduledFor, displayTimezone, content } = body as {
    scheduledFor?: string;
    displayTimezone?: string;
    content?: string;
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

  // --- Validate optional content (length check happens after we know the platform) ---
  if (content !== undefined && (typeof content !== "string" || !content.trim())) {
    return NextResponse.json(
      { ok: false, error: "Content must be a non-empty string if provided." },
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
        platform: scheduledSocialPost.platform,
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
        { ok: false, error: "Only pending posts can be edited." },
        { status: 409 },
      );
    }

    // --- Enforce the platform character limit when content changes ---
    if (content !== undefined && isSocialPlatform(rows[0].platform)) {
      const charLimit = PLATFORM_MAX_CHAR_LIMITS[rows[0].platform];
      if (content.length > charLimit) {
        return NextResponse.json(
          {
            ok: false,
            error: `Content exceeds ${charLimit.toLocaleString()} character limit for ${rows[0].platform}.`,
          },
          { status: 400 },
        );
      }
    }

    // --- Update ---
    const updates: Record<string, unknown> = {
      scheduledFor: scheduledDate,
      updatedAt: new Date(),
    };
    if (displayTimezone) {
      updates.displayTimezone = displayTimezone.trim();
    }
    if (content !== undefined) {
      updates.content = content.trim();
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
// DELETE /api/social/scheduled/[id] — permanently delete a scheduled post
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

    // Block deletion only while a post is mid-publish — deleting that row
    // out from under the cron publisher would race the running job.
    if (rows[0].status === "processing") {
      return NextResponse.json(
        { ok: false, error: "This post is publishing right now and can't be deleted." },
        { status: 409 },
      );
    }

    // Hard delete, scoped to the owner (defence in depth on top of the IDOR check above).
    await db
      .delete(scheduledSocialPost)
      .where(
        and(
          eq(scheduledSocialPost.id, id),
          eq(scheduledSocialPost.userId, user.user.id),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[social/scheduled/[id]] DELETE error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to delete post." },
      { status: 500 },
    );
  }
}
