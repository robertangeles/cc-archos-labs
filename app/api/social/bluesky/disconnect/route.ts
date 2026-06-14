import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteSocialAccount } from "@/lib/social/token";
import { getDb } from "@/lib/db";
import { scheduledSocialPost } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const runtime = "nodejs";

// POST /api/social/bluesky/disconnect
// Requires authentication. Deletes the stored Bluesky social account.
// If the user has pending scheduled posts on Bluesky, returns a 409
// requiring { confirmCancel: true } in the body before proceeding.

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  // Check for pending scheduled posts before disconnecting
  const db = getDb();
  const pendingPosts = await db
    .select({ id: scheduledSocialPost.id })
    .from(scheduledSocialPost)
    .where(
      and(
        eq(scheduledSocialPost.userId, auth.user.id),
        eq(scheduledSocialPost.platform, "bluesky"),
        eq(scheduledSocialPost.status, "pending"),
      ),
    );

  if (pendingPosts.length > 0) {
    let body: { confirmCancel?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      /* empty body is ok — treated as no confirmation */
    }

    if (!body.confirmCancel) {
      return NextResponse.json(
        {
          ok: false,
          pendingCount: pendingPosts.length,
          requiresConfirmation: true,
        },
        { status: 409 },
      );
    }

    // Auto-cancel all pending scheduled posts for this platform
    await db
      .update(scheduledSocialPost)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(scheduledSocialPost.userId, auth.user.id),
          eq(scheduledSocialPost.platform, "bluesky"),
          eq(scheduledSocialPost.status, "pending"),
        ),
      );
  }

  await deleteSocialAccount(auth.user.id, "bluesky");

  return NextResponse.json({ ok: true });
}
