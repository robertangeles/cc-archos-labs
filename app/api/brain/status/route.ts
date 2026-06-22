import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/rate-limit";
import { getUserBrain } from "@/lib/brain/provision";
import { checkHealth } from "@/lib/brain/client";

export const runtime = "nodejs";

// Fired up to twice per workspace mount (chat-workspace + BrainStatus), so
// 200/hr per user matches warm's ~100 mounts/hr allowance. Lighter than warm
// (a /health ping + one DB read); a 429 here is cosmetic (the Brain indicator
// just doesn't render that load).
const STATUS_PER_USER_PER_HOUR = 200;

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const limit = rateLimit(
    `brain-status:${auth.user.id}`,
    STATUS_PER_USER_PER_HOUR,
  );
  if (!limit.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const [brain, health] = await Promise.all([
    getUserBrain(auth.user.id),
    checkHealth(),
  ]);

  return NextResponse.json({
    provisioned: !!brain,
    serviceHealthy: !!health,
    lastActiveAt: brain?.lastActiveAt ?? null,
  });
}
