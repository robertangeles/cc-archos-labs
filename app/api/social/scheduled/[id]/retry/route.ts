import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { scheduledSocialPost } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSocialAccount } from "@/lib/social/token";
import type { SocialPlatform } from "@/lib/social/types";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// POST /api/social/scheduled/[id]/retry — retry a failed post
// ---------------------------------------------------------------------------
export async function POST(
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

    const post = rows[0];

    if (post.status !== "failed") {
      return NextResponse.json(
        { ok: false, error: "Only failed posts can be retried." },
        { status: 409 },
      );
    }

    // Verify the user still has a connected account for this platform
    const account = await getSocialAccount(
      user.user.id,
      post.platform as SocialPlatform,
    );
    if (!account || !account.isConnected) {
      return NextResponse.json(
        {
          ok: false,
          error: `No connected ${post.platform} account. Reconnect it before retrying.`,
        },
        { status: 400 },
      );
    }

    // Reset to pending for re-processing
    await db
      .update(scheduledSocialPost)
      .set({
        status: "pending",
        attempts: 0,
        errorMessage: null,
        lastAttemptedAt: null,
        lockedBy: null,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(scheduledSocialPost.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[social/scheduled/[id]/retry] POST error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to retry post." },
      { status: 500 },
    );
  }
}
