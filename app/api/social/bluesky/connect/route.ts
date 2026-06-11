import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getIntegrationConfig } from "@/lib/integration-config";
import { connectBluesky, BlueskyAuthError } from "@/lib/social/bluesky";
import { storeSocialTokens } from "@/lib/social/token";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  // Gate on integration toggle
  const config = await getIntegrationConfig();
  if (!config.blueskyEnabled) {
    return NextResponse.json(
      { error: "Bluesky integration is not enabled" },
      { status: 403 },
    );
  }

  // Validate input
  let body: { handle?: unknown; appPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { handle, appPassword } = body;
  if (typeof handle !== "string" || handle.trim().length === 0) {
    return NextResponse.json(
      { error: "handle is required" },
      { status: 400 },
    );
  }
  if (typeof appPassword !== "string" || appPassword.trim().length === 0) {
    return NextResponse.json(
      { error: "appPassword is required" },
      { status: 400 },
    );
  }

  try {
    // Authenticate with AT Protocol
    const session = await connectBluesky(handle.trim(), appPassword.trim());

    // Store credentials: app password in accessToken, refresh JWT in refreshToken
    await storeSocialTokens(auth.user.id, "bluesky", {
      accessToken: appPassword.trim(),
      refreshToken: session.refreshJwt,
      expiresAt: undefined,
      accountId: session.did,
      accountName: session.handle,
    });

    return NextResponse.json({
      success: true,
      accountName: session.handle,
      accountId: session.did,
    });
  } catch (err) {
    if (err instanceof BlueskyAuthError) {
      return NextResponse.json(
        { error: "Invalid handle or app password" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "Failed to connect Bluesky account" },
      { status: 500 },
    );
  }
}
