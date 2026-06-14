import { getCurrentUser } from "../../../../../lib/auth/current-user";
import { deleteSocialAccount } from "../../../../../lib/social/token";
import {
  assertSameOriginRequest,
  CsrfOriginError,
} from "../../../../../lib/auth/csrf";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../../lib/rate-limit";
import { getDb } from "@/lib/db";
import { scheduledSocialPost } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const runtime = "nodejs";

// POST /api/social/twitter/disconnect
// Removes the user's Twitter connection (hard delete of the
// social_account row). Requires authentication and CSRF check.
// If the user has pending scheduled posts on Twitter, returns a 409
// requiring { confirmCancel: true } in the body before proceeding.

const DISCONNECTS_PER_IP_PER_HOUR = 20;

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
  } catch (err) {
    if (err instanceof CsrfOriginError) {
      return Response.json({ ok: false, error: "csrf" }, { status: 403 });
    }
    throw err;
  }

  const ip = clientIpFromRequest(request);
  const limit = rateLimit(
    `twitter-disconnect:ip:${ip}`,
    DISCONNECTS_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

  const session = await getCurrentUser();
  if (!session) {
    return Response.json(
      { ok: false, error: "Authentication required." },
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
        eq(scheduledSocialPost.userId, session.user.id),
        eq(scheduledSocialPost.platform, "twitter"),
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
      return Response.json(
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
          eq(scheduledSocialPost.userId, session.user.id),
          eq(scheduledSocialPost.platform, "twitter"),
          eq(scheduledSocialPost.status, "pending"),
        ),
      );
  }

  await deleteSocialAccount(session.user.id, "twitter");

  return Response.json({ ok: true });
}
