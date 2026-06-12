import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/rate-limit";
import { publishToSocial } from "@/lib/social/publish";
import { isSocialPlatform } from "@/lib/social/types";
import type { PublishRequest } from "@/lib/social/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`social-publish:${user.user.id}`, 20);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Max 20 publishes per hour." },
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
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { platforms } = body as { platforms?: Record<string, { content?: string }> };
  if (!platforms || typeof platforms !== "object") {
    return NextResponse.json(
      { error: "Missing 'platforms' object." },
      { status: 400 },
    );
  }

  const validPlatforms: PublishRequest["platforms"] = {};
  for (const [key, val] of Object.entries(platforms)) {
    if (!isSocialPlatform(key)) {
      return NextResponse.json(
        { error: `Invalid platform: ${key}` },
        { status: 400 },
      );
    }
    if (!val?.content || typeof val.content !== "string" || !val.content.trim()) {
      return NextResponse.json(
        { error: `Empty content for platform: ${key}` },
        { status: 400 },
      );
    }
    validPlatforms[key] = { content: val.content };
  }

  if (Object.keys(validPlatforms).length === 0) {
    return NextResponse.json(
      { error: "No platforms with content provided." },
      { status: 400 },
    );
  }

  try {
    const result = await publishToSocial(user.user.id, {
      platforms: validPlatforms,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[social/publish] unexpected error:", err);
    return NextResponse.json(
      { error: "Publish failed. Please try again." },
      { status: 500 },
    );
  }
}
