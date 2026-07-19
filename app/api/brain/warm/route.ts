import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/rate-limit";
import { warmBrain } from "@/lib/brain/warm";
import { memoryBackend } from "@/lib/brain/memory";

export const runtime = "nodejs";

// Fires once per workspace mount. 100/hr per user is ~one mount every 36s
// sustained — generous for real use, but caps an authed user from spamming
// warm to hammer GBrain. Hitting it degrades gracefully: warm is best-effort
// (the client ignores the response) and recall still works via its timeout.
const WARM_PER_USER_PER_HOUR = 100;

// POST /api/brain/warm — wake the caller's GBrain ahead of their first
// message so memory recall doesn't cold-start mid-send. Auth-gated to the
// caller's own brain; best-effort (always 200 once authed). Awaited so the
// warm-up actually completes before the serverless function is torn down.
export async function POST() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const limit = rateLimit(`brain-warm:${auth.user.id}`, WARM_PER_USER_PER_HOUR);
  if (!limit.ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // pgvector backend has no external cold start to warm — no-op success.
  if (memoryBackend() === "pgvector") {
    return NextResponse.json({ warmed: true });
  }

  await warmBrain(auth.user.id);
  return NextResponse.json({ warmed: true });
}
