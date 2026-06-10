import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getUserBrain } from "@/lib/brain/provision";
import { checkHealth } from "@/lib/brain/client";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
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
