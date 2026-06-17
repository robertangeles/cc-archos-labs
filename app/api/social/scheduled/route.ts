import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { rateLimit, clientIpFromRequest } from "@/lib/rate-limit";
import { getDb } from "@/lib/db";
import { scheduledSocialPost } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { isSocialPlatform, PLATFORM_MAX_CHAR_LIMITS } from "@/lib/social/types";
import { getSocialAccount } from "@/lib/social/token";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET /api/social/scheduled — list scheduled posts for the current user
// ---------------------------------------------------------------------------
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: scheduledSocialPost.id,
        platform: scheduledSocialPost.platform,
        content: scheduledSocialPost.content,
        scheduledFor: scheduledSocialPost.scheduledFor,
        displayTimezone: scheduledSocialPost.displayTimezone,
        status: scheduledSocialPost.status,
        publishedUrl: scheduledSocialPost.publishedUrl,
        publishedAt: scheduledSocialPost.publishedAt,
        errorMessage: scheduledSocialPost.errorMessage,
        attempts: scheduledSocialPost.attempts,
        createdAt: scheduledSocialPost.createdAt,
      })
      .from(scheduledSocialPost)
      .where(eq(scheduledSocialPost.userId, user.user.id))
      .orderBy(asc(scheduledSocialPost.scheduledFor));

    // Return first 200 chars as a preview, plus full content for inline editing
    const posts = rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      contentPreview: row.content.slice(0, 200),
      content: row.content,
      scheduledFor: row.scheduledFor,
      displayTimezone: row.displayTimezone,
      status: row.status,
      publishedUrl: row.publishedUrl,
      publishedAt: row.publishedAt,
      errorMessage: row.errorMessage,
      attempts: row.attempts,
      createdAt: row.createdAt,
    }));

    return NextResponse.json({ ok: true, posts });
  } catch (err) {
    console.error("[social/scheduled] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load scheduled posts." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/social/scheduled — create a new scheduled post
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const ip = clientIpFromRequest(request);
  const rl = rateLimit(`social-schedule:${ip}`, 20);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Max 20 scheduled posts per hour." },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(
            (rl.resetAt - Date.now()) / 1000,
          ).toString(),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { platform, content, scheduledFor, displayTimezone } = body as {
    platform?: string;
    content?: string;
    scheduledFor?: string;
    displayTimezone?: string;
  };

  // --- Validate platform ---
  if (!platform || typeof platform !== "string" || !isSocialPlatform(platform)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing platform." },
      { status: 400 },
    );
  }

  // --- Validate content ---
  if (!content || typeof content !== "string" || !content.trim()) {
    return NextResponse.json(
      { ok: false, error: "Content is required." },
      { status: 400 },
    );
  }

  const charLimit = PLATFORM_MAX_CHAR_LIMITS[platform];
  if (content.length > charLimit) {
    return NextResponse.json(
      {
        ok: false,
        error: `Content exceeds ${charLimit.toLocaleString()} character limit for ${platform}.`,
      },
      { status: 400 },
    );
  }

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

  // --- Validate displayTimezone ---
  if (!displayTimezone || typeof displayTimezone !== "string" || !displayTimezone.trim()) {
    return NextResponse.json(
      { ok: false, error: "displayTimezone is required." },
      { status: 400 },
    );
  }

  // --- Check connected social account ---
  try {
    const account = await getSocialAccount(user.user.id, platform);
    if (!account || !account.isConnected) {
      return NextResponse.json(
        { ok: false, error: `No connected ${platform} account. Connect it first.` },
        { status: 400 },
      );
    }
  } catch (err) {
    console.error("[social/scheduled] account check error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to verify social account." },
      { status: 500 },
    );
  }

  // --- Insert ---
  try {
    const db = getDb();
    const [newRow] = await db
      .insert(scheduledSocialPost)
      .values({
        userId: user.user.id,
        platform,
        content: content.trim(),
        scheduledFor: scheduledDate,
        displayTimezone: displayTimezone.trim(),
        status: "pending",
      })
      .returning({ id: scheduledSocialPost.id });

    return NextResponse.json({ ok: true, id: newRow.id }, { status: 201 });
  } catch (err) {
    console.error("[social/scheduled] POST insert error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to create scheduled post." },
      { status: 500 },
    );
  }
}
