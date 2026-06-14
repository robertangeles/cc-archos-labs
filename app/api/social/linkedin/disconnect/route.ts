import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteSocialAccount } from "@/lib/social/token";
import { clientIpFromRequest, rateLimit } from "@/lib/rate-limit";
import { getDb } from "@/lib/db";
import { scheduledSocialPost } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const runtime = "nodejs";

// POST /api/social/linkedin/disconnect
// Requires authentication. Deletes the stored LinkedIn social account
// (tokens are hard-deleted, not soft-revoked — LinkedIn does not offer
// a server-side token revocation endpoint).
// If the user has pending scheduled posts on LinkedIn, returns a 409
// requiring { confirmCancel: true } in the body before proceeding.

const DISCONNECTS_PER_IP_PER_HOUR = 20;

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const ip = clientIpFromRequest(request);
  const limit = rateLimit(
    `linkedin-disconnect:ip:${ip}`,
    DISCONNECTS_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 },
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
        eq(scheduledSocialPost.platform, "linkedin"),
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
          eq(scheduledSocialPost.platform, "linkedin"),
          eq(scheduledSocialPost.status, "pending"),
        ),
      );
  }

  await deleteSocialAccount(auth.user.id, "linkedin");

  return NextResponse.json({ ok: true });
}
