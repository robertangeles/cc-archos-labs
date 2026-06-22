import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { warmBrain } from "@/lib/brain/warm";

export const runtime = "nodejs";

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

  await warmBrain(auth.user.id);
  return NextResponse.json({ warmed: true });
}
