import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { provisionBrain, getUserBrain } from "@/lib/brain/provision";
import { getIntegrationConfig } from "@/lib/integration-config";

export const runtime = "nodejs";

export async function POST() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const config = await getIntegrationConfig();
  if (!config.gbrainUrl || !config.gbrainAdminToken) {
    return NextResponse.json(
      { error: "Brain service not configured" },
      { status: 503 },
    );
  }

  try {
    const brain = await provisionBrain(auth.user.id);
    return NextResponse.json({
      provisioned: true,
      provisionedAt: brain.provisionedAt,
    });
  } catch (e) {
    // Don't leak the raw error (it can carry GBrain infra detail / status
    // codes) to the client. Log it server-side for diagnosis; return a
    // generic message.
    console.error(`[brain:provision] failed for user=${auth.user.id}:`, e);
    return NextResponse.json(
      { error: "Provisioning failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const brain = await getUserBrain(auth.user.id);
  return NextResponse.json({
    provisioned: !!brain,
    provisionedAt: brain?.provisionedAt ?? null,
    lastActiveAt: brain?.lastActiveAt ?? null,
  });
}
